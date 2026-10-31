import { inject, injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import URI from '@theia/core/lib/common/uri';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { FileChangeType, type FileChangesEvent } from '@theia/filesystem/lib/common/files';
import { ProblemManager } from '@theia/markers/lib/browser/problem/problem-manager';
import { ProblemContribution } from '@theia/markers/lib/browser/problem/problem-contribution';
import { RulesInsightService } from '../../common/rules-insight/rules-insight.types';
import { DOCTOR_DEBOUNCE_MS, DOCTOR_MARKER_OWNER, RULES_INSIGHT_COMMANDS, SCHEMA_MARKER_OWNER, SCHEMA_SOURCE, WALK_SKIP } from '../../common/rules-insight/rules-insight.consts';
import { doctorSummaryText, findingToDiagnostic, globalRelative, groupFindings } from '../../common/rules-insight/rules-insight.utils';
import { DOCTOR_CONFIG_FILE } from '../../common/rules-engine/rules-engine.consts';
import { classifyRulePath } from '../../common/rules-engine/rule-docs.utils';
import { schemaForPath } from '../../common/rules-engine/schema-validate.utils';
import type { DoctorReport } from '../../common/rules-engine/rules-engine.types';
import type { MarkedFile } from '../../common/rules-insight/rules-insight.types';

/** Rules Doctor in the IDE (IDEA-317): findings go to the Problems view and refresh when a rule or `.ingot` file changes. */
@injectable()
export class RulesDoctorContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(RulesInsightService) protected readonly service: RulesInsightService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FileService) protected readonly files: FileService;
    @inject(ProblemManager) protected readonly problems: ProblemManager;
    @inject(ProblemContribution) protected readonly problemsView: ProblemContribution;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;

    protected readonly onDidReportEmitter = new Emitter<DoctorReport | undefined>();
    readonly onDidReport: Event<DoctorReport | undefined> = this.onDidReportEmitter.event;

    protected lastReport?: DoctorReport;
    protected markedUris: MarkedFile[] = [];
    protected timer?: ReturnType<typeof setTimeout>;
    protected configDir?: URI;
    protected filesStale = false;

    get report(): DoctorReport | undefined {
        return this.lastReport;
    }

    get root(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    onStart(): void {
        this.env.getConfigDirUri().then(dir => { this.configDir = new URI(dir); }).catch(() => undefined);
        this.workspace.ready.then(() => this.schedule()).catch(() => undefined);
        this.workspace.onWorkspaceChanged(() => this.schedule());
        this.files.onDidFilesChange(event => {
            const structural = this.addsOrRemovesProjectFiles(event);
            this.filesStale ||= structural;
            if (structural || this.affectsRules(event)) {
                this.schedule();
            }
        });
    }

    /** New or deleted files can bring a dead glob back to life (or kill one), so the cached file list is dropped. */
    protected addsOrRemovesProjectFiles(event: FileChangesEvent): boolean {
        const root = this.root;
        return event.changes.some(change => {
            if (change.type === FileChangeType.UPDATED) {
                return false;
            }
            const rel = root?.relative(change.resource)?.toString();
            return rel !== undefined && !rel.split('/').some(part => (WALK_SKIP as readonly string[]).includes(part));
        });
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(RULES_INSIGHT_COMMANDS.doctor, { execute: () => this.runAndReveal() });
    }

    protected affectsRules(event: FileChangesEvent): boolean {
        const root = this.root;
        return event.changes.some(change => {
            const uri = change.resource;
            if (this.configDir?.isEqualOrParent(uri)) {
                return true;
            }
            const rel = root?.relative(uri)?.toString();
            return rel !== undefined && (!!classifyRulePath(rel) || !!schemaForPath(rel) || rel === DOCTOR_CONFIG_FILE);
        });
    }

    protected schedule(): void {
        clearTimeout(this.timer);
        this.timer = setTimeout(() => this.run().catch(() => undefined), DOCTOR_DEBOUNCE_MS);
    }

    async runAndReveal(): Promise<DoctorReport | undefined> {
        const report = await this.run();
        if (!report) {
            this.messages.info('Open a project folder to run Rules Doctor.');
            return undefined;
        }
        await this.problemsView.openView({ activate: false, reveal: true });
        this.messages.info(doctorSummaryText(report));
        return report;
    }

    async run(): Promise<DoctorReport | undefined> {
        const root = this.root;
        if (!root) {
            this.publish(undefined, undefined);
            return undefined;
        }
        if (this.filesStale) {
            this.filesStale = false;
            await this.service.invalidateFiles(root.path.fsPath());
        }
        const report = await this.service.doctor(root.path.fsPath());
        this.publish(root, report);
        return report;
    }

    protected uriFor(root: URI, path: string): URI | undefined {
        const global = globalRelative(path);
        if (global !== undefined) {
            return this.configDir?.resolve(global);
        }
        return root.resolve(path);
    }

    /** Schema findings share the live editor validator's owner, so a file never shows the same problem twice. */
    protected publish(root: URI | undefined, report: DoctorReport | undefined): void {
        const next: MarkedFile[] = [];
        if (root && report) {
            for (const [owner, findings] of [[DOCTOR_MARKER_OWNER, report.findings.filter(f => f.code !== 'schema')], [SCHEMA_MARKER_OWNER, report.findings.filter(f => f.code === 'schema')]] as const) {
                for (const [path, group] of groupFindings(findings)) {
                    const uri = this.uriFor(root, path);
                    if (uri) {
                        this.problems.setMarkers(uri, owner, group.map(f => owner === SCHEMA_MARKER_OWNER ? { ...findingToDiagnostic(f), source: SCHEMA_SOURCE } : findingToDiagnostic(f)));
                        next.push({ uri, owner });
                    }
                }
            }
        }
        for (const old of this.markedUris) {
            if (!next.some(m => m.owner === old.owner && m.uri.isEqual(old.uri))) {
                this.problems.setMarkers(old.uri, old.owner, []);
            }
        }
        this.markedUris = next;
        this.lastReport = report;
        this.onDidReportEmitter.fire(report);
    }
}
