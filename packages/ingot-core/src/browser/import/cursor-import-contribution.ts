import { inject, injectable } from '@theia/core/shared/inversify';
import { QuickInputService, type FrontendApplicationContribution, type QuickPickItem } from '@theia/core/lib/browser';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { type PreferenceSchema, PreferenceService } from '@theia/core/lib/common/preferences';
import URI from '@theia/core/lib/common/uri';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { CONFIG_DIRS, NESTED_RULES_MAX_DEPTH } from '../../common/project-config/project-config.consts';
import { CURSOR_IMPORT_MODES, CURSOR_IMPORT_PREFERENCE, DEFAULT_CURSOR_IMPORT_MODE } from '../../common/import/cursor-rules-import.consts';
import { toCursorImportMode } from '../../common/import/cursor-rules-import.utils';
import {
    CURSOR_CONVERT_COMMAND, CURSOR_MODE_COMMAND, CURSOR_MODE_DETAILS, CURSOR_MODE_LABELS, CURSOR_MODE_RESET_LABEL, CURSOR_MODES, CURSOR_PROMPT, CURSOR_SIGNALS
} from '../../common/import/cursor-mode.consts';
import type { CursorMode } from '../../common/import/cursor-mode.types';
import { shouldAskCursorMode } from '../../common/import/cursor-mode.utils';
import {
    CURSOR_COPIED_DIRS, CURSOR_COPIED_FILES, CURSOR_ENVIRONMENT_PATH, CURSOR_NESTED_GLOBS, CURSOR_ROOT_FILES, CURSOR_WALK_MAX_FILES, MERGE_TARGETS
} from '../../common/import/cursor-convert.consts';
import type { CursorConversionPlan, CursorSourceFile } from '../../common/import/cursor-convert.types';
import { conversionSummary, cursorTargetFor, environmentBuildFiles, planCursorConversion } from '../../common/import/cursor-convert.utils';
import { parseRgFiles } from '../../common/agents/workspace-tools';
import { ProcessService } from '../../common/processes/processes.types';
import { IngotMcpClient } from '../project-config/mcp-client';
import { AgentStore } from '../agents/agent-store';
import { CursorModeService } from './cursor-mode-service';

export const cursorImportPreferenceSchema: PreferenceSchema = {
    properties: {
        [CURSOR_IMPORT_PREFERENCE]: {
            type: 'string', enum: [...CURSOR_IMPORT_MODES], default: DEFAULT_CURSOR_IMPORT_MODE,
            enumDescriptions: [
                'Ask once per workspace: import (convert into .ingot, or keep reading .cursor) or not.',
                'Never ask; a workspace keeps reading .cursor live. Change it with "Cursor Config: Change Import Mode…".'
            ],
            description: 'Opening a workspace with Cursor config (.cursor, .cursorrules, .cursorignore, AGENTS.md) asks once how Ingot should use it.'
        }
    }
};

/** Copy kinds whose files are not read as text (scripts and skill assets keep their bytes and mode). */
const COPIED_AS_IS = new Set(['skill', 'hookScript', 'habit']);

interface ModePick extends QuickPickItem { readonly mode?: CursorMode }

/**
 * IDEA-287: first open of a workspace with Cursor config asks "Import?" and then "Convert to .ingot" (copy and translate,
 * `.cursor` untouched) or "Keep .cursor" (read live, copy nothing). The answer is remembered per workspace; "No" stops
 * Ingot reading Cursor files there. "Cursor Config: Change Import Mode…" changes it later.
 */
@injectable()
export class CursorImportContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FileService) protected readonly files: FileService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(ProcessService) protected readonly processes: ProcessService;
    @inject(CursorModeService) protected readonly modes: CursorModeService;
    @inject(IngotMcpClient) protected readonly mcp: IngotMcpClient;
    @inject(AgentStore) protected readonly agents: AgentStore;

    protected readonly onDidConvertEmitter = new Emitter<URI>();
    /** IDEA-287: fires after "Convert to .ingot" wrote its files (the sync records what it wrote). */
    readonly onDidConvert: Event<URI> = this.onDidConvertEmitter.event;

    /** Roots already asked in this window, so a workspace event does not stack a second prompt. */
    protected readonly asked = new Set<string>();

    onDidInitializeLayout(): void {
        void this.offer();
        this.workspace.onWorkspaceChanged(() => void this.offer());
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(CURSOR_MODE_COMMAND, { execute: () => this.pickMode(), isEnabled: () => !!this.root() });
        registry.registerCommand(CURSOR_CONVERT_COMMAND, { execute: () => this.applyMode(this.root()!, 'convert'), isEnabled: () => !!this.root() });
    }

    protected root(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    /** Cursor files at the workspace root that make Ingot ask. */
    async signals(root: URI): Promise<string[]> {
        const found = await Promise.all(CURSOR_SIGNALS.map(async signal => await this.files.exists(root.resolve(signal)) ? signal : undefined));
        return found.filter((s): s is typeof CURSOR_SIGNALS[number] => !!s);
    }

    protected async offer(): Promise<void> {
        const root = (await this.workspace.roots)[0]?.resource;
        if (!root || this.asked.has(root.toString())) {
            return;
        }
        await this.preferences.ready;
        const [signals, mode] = await Promise.all([this.signals(root), this.modes.modeFor(root)]);
        if (!shouldAskCursorMode(signals.length, mode, toCursorImportMode(this.preferences.get(CURSOR_IMPORT_PREFERENCE)) === 'ask')) {
            return;
        }
        this.asked.add(root.toString());
        const answer = await this.messages.info(`${CURSOR_PROMPT.ask} (${signals.join(', ')}). Import it into Ingot?`, CURSOR_PROMPT.yes, CURSOR_PROMPT.no);
        if (answer === CURSOR_PROMPT.no) {
            await this.applyMode(root, 'off');
        } else if (answer === CURSOR_PROMPT.yes) {
            await this.chooseHow(root);
        }
    }

    /** The second question. Closing it without an answer asks again on the next open. */
    protected async chooseHow(root: URI): Promise<void> {
        const answer = await this.messages.info(
            `${CURSOR_PROMPT.how} ${CURSOR_PROMPT.convert}: ${CURSOR_MODE_DETAILS.convert} ${CURSOR_PROMPT.keep}: ${CURSOR_MODE_DETAILS.keep}`,
            CURSOR_PROMPT.convert, CURSOR_PROMPT.keep
        );
        if (answer === CURSOR_PROMPT.convert) {
            await this.applyMode(root, 'convert');
        } else if (answer === CURSOR_PROMPT.keep) {
            await this.applyMode(root, 'keep');
        }
    }

    protected async pickMode(): Promise<void> {
        const root = this.root();
        if (!root) {
            return;
        }
        const current = await this.modes.modeFor(root);
        const items: ModePick[] = [
            ...CURSOR_MODES.map(mode => ({ mode, label: CURSOR_MODE_LABELS[mode], detail: CURSOR_MODE_DETAILS[mode], ...(mode === current ? { description: 'current' } : {}) })),
            { label: CURSOR_MODE_RESET_LABEL, detail: 'Forget the answer for this workspace; until then .cursor is read live.', ...(!current ? { description: 'current' } : {}) }
        ];
        const picked = await this.quickInput.showQuickPick(items, { title: 'Cursor config in this workspace', placeholder: 'How should Ingot use .cursor?' }) as ModePick | undefined;
        if (!picked) {
            return;
        }
        if (picked.mode) {
            await this.applyMode(root, picked.mode);
        } else {
            await this.modes.setMode(root, undefined);
            this.asked.delete(root.toString());
            await this.refresh(root);
        }
    }

    /** Saves the answer (converting first for `convert`) and reloads rules, commands and MCP servers. */
    async applyMode(root: URI, mode: CursorMode): Promise<void> {
        if (mode === 'convert') {
            await this.convert(root);
        }
        await this.modes.setMode(root, mode);
        await this.refresh(root);
        if (mode !== 'convert') {
            this.messages.info(mode === 'keep' ? `Ingot reads .cursor live in this workspace. ${CURSOR_MODE_COMMAND.label} changes it.`
                : `Ingot does not use Cursor config in this workspace. ${CURSOR_MODE_COMMAND.label} changes it.`);
        }
    }

    async refresh(root: URI): Promise<void> {
        await Promise.all([this.mcp.refresh(root).catch(() => undefined), this.agents.loadCommands().catch(() => undefined)]);
    }

    /** "Convert to .ingot": copies and translates every Cursor file; existing `.ingot` files are kept (merge files are merged). */
    async convert(root: URI): Promise<CursorConversionPlan> {
        const plan = await this.plan(root);
        let written = 0;
        for (const step of plan.steps) {
            const target = root.resolve(step.target);
            try {
                if (step.text === undefined) {
                    if (!await this.files.exists(target)) {
                        await this.files.copy(root.resolve(step.from), target);
                        written++;
                    }
                } else if (step.merge || !await this.files.exists(target)) {
                    await this.files.write(target, step.text);
                    written++;
                }
            } catch (error) {
                this.messages.error(`Could not convert ${step.from}: ${error instanceof Error ? error.message : String(error)}`);
            }
        }
        plan.skipped.forEach(skip => this.messages.warn(`Skipped ${skip.from}: ${skip.reason}`));
        this.messages.info(written
            ? `Converted Cursor config into ${CONFIG_DIRS.ingot}: ${conversionSummary(plan.steps)}. ${CONFIG_DIRS.external} was left untouched.`
            : `Nothing left to convert: ${CONFIG_DIRS.ingot} already has this workspace's Cursor config.`);
        this.onDidConvertEmitter.fire(root);
        return plan;
    }

    async plan(root: URI): Promise<CursorConversionPlan> {
        const sources = await this.sources(root);
        const targets = sources.flatMap(source => {
            const target = cursorTargetFor(source.path)?.target;
            return target ? [target, target.replace(/\.md$/, '.mdc')] : [];
        });
        const existing = (await Promise.all([...new Set(targets)].map(async path => await this.files.exists(root.resolve(path)) ? path : undefined)))
            .filter((p): p is string => !!p);
        const mergeTargets = Object.values(MERGE_TARGETS);
        const current = Object.fromEntries((await Promise.all(mergeTargets.map(async path => [path, await this.read(root.resolve(path))] as const)))
            .filter((entry): entry is readonly [typeof mergeTargets[number], string] => entry[1] !== undefined));
        return planCursorConversion({ sources, existing, current });
    }

    /** Every Cursor file of the workspace: the root `.cursor` folder, root files and nested rules / AGENTS.md / BUGBOT.md. */
    async sources(root: URI): Promise<CursorSourceFile[]> {
        const paths = new Set<string>();
        const buildFiles = new Set<string>();
        const cursor = root.resolve(CONFIG_DIRS.external);
        await Promise.all([
            ...CURSOR_COPIED_DIRS.map(dir => this.walk(cursor.resolve(dir), `${CONFIG_DIRS.external}/${dir}`, paths, 0)),
            ...[...CURSOR_COPIED_FILES.map(file => `${CONFIG_DIRS.external}/${file}`), ...CURSOR_ROOT_FILES].map(async path => {
                if (await this.files.exists(root.resolve(path))) {
                    paths.add(path);
                }
            })
        ]);
        if (paths.has(CURSOR_ENVIRONMENT_PATH)) {
            const builds = environmentBuildFiles(await this.read(root.resolve(CURSOR_ENVIRONMENT_PATH)));
            const present = await Promise.all(builds.map(async path => await this.files.exists(root.resolve(path)) ? path : undefined));
            present.forEach(path => path && buildFiles.add(path));
        }
        const cwd = root.path.fsPath();
        const nested = cwd ? await this.processes.workspaceSearch({ cwd, files: true, globs: [...CURSOR_NESTED_GLOBS] }).catch(() => undefined) : undefined;
        if (nested?.engine === 'ripgrep') {
            parseRgFiles(nested.text, CURSOR_WALK_MAX_FILES).forEach(path => paths.add(path.replace(/\\/g, '/').replace(/^\.\//, '')));
        }
        return Promise.all([
            ...[...paths].filter(path => !buildFiles.has(path)).map(async path => {
                const mapping = cursorTargetFor(path);
                const copied = mapping && COPIED_AS_IS.has(mapping.kind);
                return copied ? { path } : { path, text: await this.read(root.resolve(path)) ?? '' };
            }),
            ...[...buildFiles].map(path => ({ path, buildFile: true }))
        ]);
    }

    protected async walk(dir: URI, prefix: string, into: Set<string>, depth: number): Promise<void> {
        if (depth > NESTED_RULES_MAX_DEPTH || into.size >= CURSOR_WALK_MAX_FILES) {
            return;
        }
        const stat = await this.files.resolve(dir).catch(() => undefined);
        await Promise.all((stat?.children ?? []).map(child => child.isDirectory
            ? this.walk(child.resource, `${prefix}/${child.name}`, into, depth + 1)
            : Promise.resolve(void into.add(`${prefix}/${child.name}`))));
    }

    protected async read(uri: URI): Promise<string | undefined> {
        return this.files.read(uri).then(content => content.value, () => undefined);
    }
}
