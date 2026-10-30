import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { ProjectConfigService } from './project-config-service';
import { CONFIG_DIRS, RULES_DIR } from '../../common/project-config/project-config.consts';
import type { ProjectRule, RuleDraft } from '../../common/project-config/project-config.types';
import { ruleFileName, ruleFileText } from '../../common/project-config/project-config.utils';
import type { RuleScope, UserRulesList } from './user-rules.types';

/** IDEA-295: global (`~/.ingot/rules`) and project (`.ingot/rules`, AGENTS.md) rules for the User Rules settings page. */
@injectable()
export class UserRulesService {

    @inject(FileService) protected readonly files: FileService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(ProjectConfigService) protected readonly projectConfig: ProjectConfigService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    get root(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    async list(): Promise<UserRulesList> {
        const rules = (await this.projectConfig.load(this.root)).rules;
        const editable = (r: ProjectRule): boolean => !!r.uri && !r.scope;
        return {
            global: rules.filter(r => r.source === 'global' && editable(r)),
            project: rules.filter(r => (r.source === 'ingot' || r.source === 'agents') && editable(r)),
            other: rules.filter(r => !editable(r) || !['global', 'ingot', 'agents'].includes(r.source))
        };
    }

    async readRaw(rule: ProjectRule): Promise<string> {
        return rule.uri ? (await this.files.read(new URI(rule.uri))).value : rule.body;
    }

    async save(rule: ProjectRule, text: string): Promise<void> {
        if (rule.uri) {
            await this.files.write(new URI(rule.uri), text);
            this.onDidChangeEmitter.fire();
        }
    }

    /** Writes a new rule file; returns an error message when it cannot. */
    async create(scope: RuleScope, draft: RuleDraft): Promise<string | undefined> {
        const name = ruleFileName(draft.name);
        if (!name || !draft.body.trim()) {
            return 'A rule needs a name and some text.';
        }
        const dir = scope === 'global' ? (await this.projectConfig.globalDir()).resolve(RULES_DIR) : this.root?.resolve(CONFIG_DIRS.ingot).resolve(RULES_DIR);
        if (!dir) {
            return 'Open a project to add project rules.';
        }
        const target = dir.resolve(name);
        if (await this.files.exists(target)) {
            return `${name} already exists.`;
        }
        await this.files.create(target, ruleFileText(draft));
        this.onDidChangeEmitter.fire();
        return undefined;
    }

    async remove(rule: ProjectRule): Promise<void> {
        if (rule.uri) {
            await this.files.delete(new URI(rule.uri));
            this.onDidChangeEmitter.fire();
        }
    }
}
