import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { OS } from '@theia/core/lib/common/os';
import { ApplicationServer } from '@theia/core/lib/common/application-protocol';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { ProcessService } from '../../common/processes/processes.types';
import {
    CLAUDE_PROJECT_HOOK_FILES, CLAUDE_USER_HOOK_FILE, HOOK_FILES_TTL_MS, HOOK_MS_PER_SECOND, PROMPT_HOOK_MAX_TOKENS, PROMPT_HOOK_SYSTEM, SYSTEM_HOOK_FILES, SYSTEM_HOOKS_DIR_ENV,
    TEAM_HOOKS_CONFIG_KEY, TEAM_HOOKS_SOURCE, USER_HOOKS_FILE
} from '../../common/hooks/agent-hooks.consts';
import { claudeHookPayload, parseClaudeHooks } from '../../common/hooks/claude-hooks.utils';
import type {
    AgentHookCommand, AgentHookEvent, AgentHookOutcome, AgentHooksParse, HookCommandResult, HookFileSource, HookPayloadBase, HookResponse
} from '../../common/hooks/agent-hooks.types';
import {
    hookEnv, hookMatches, hookMatchValue, hookOutcome, hookPayload, mergeAgentHooks, parseAgentHooks, parseHookOutput, parseHooksObject, parsePromptHookAnswer,
    promptHookText, underLoopLimit
} from '../../common/hooks/agent-hooks.utils';
import { agentHookFileNames } from '../../common/import/cursor-mode.utils';
import { CONFIG_DIRS } from '../../common/project-config/project-config.consts';
import { PRODUCT } from '../../common/product.consts';
import { ProjectConfigService } from '../project-config/project-config-service';
import { IngotFeatureFlags } from '../config/feature-flags';
import { IngotAccountService } from '../account/account-service';
import { IngotModelClient } from '../models/model-client';
import { AiCommitService } from '../commit/ai-commit-service';
import { AGENT_EVENT_HOOKS_PREF, CLAUDE_HOOKS_PREF } from './hooks.consts';

/** Per run: the chat's sessionStart env and how many stop follow-ups it already sent. */
export interface HookRunOptions {
    readonly sessionEnv?: Readonly<Record<string, string>>;
    readonly loopCount?: number;
}

interface HookFile extends HookFileSource {
    readonly uri: URI;
    /** IDEA-287: a Claude Code settings file instead of a hooks.json. */
    readonly claude?: boolean;
}

const SYSTEM_FILES: Record<OS.Type, readonly string[]> = {
    [OS.Type.OSX]: SYSTEM_HOOK_FILES.osx,
    [OS.Type.Linux]: SYSTEM_HOOK_FILES.linux,
    [OS.Type.Windows]: SYSTEM_HOOK_FILES.windows
};

/**
 * IDEA-294: Cursor-style agent hooks. Commands listed under `"hooks"` in `.ingot/hooks.json` (and `.cursor/hooks.json`)
 * run on agent events with the event as JSON on stdin; permission hooks answer allow / deny / ask. The git stages of the
 * same file keep running through AgentHooksService. IDEA-287: every Cursor event, matchers, `failClosed`, `loop_limit`
 * and prompt hooks; hooks merge from system-wide (enterprise) files, the account's team hooks, the project and the user
 * (`~/.cursor/hooks.json`, `~/.ingot/hooks.json`), in that order. `.cursor/hooks.json` only while the workspace reads `.cursor` live.
 * Claude Code hooks (`.claude/settings.local.json`, `.claude/settings.json`, `~/.claude/settings.json`) run last, as in Cursor.
 */
@injectable()
export class AgentEventHooks {

    @inject(FileService) protected readonly files: FileService;
    @inject(ProcessService) protected readonly processes: ProcessService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(ProjectConfigService) protected readonly projectConfig: ProjectConfigService;
    @inject(ApplicationServer) protected readonly app: ApplicationServer;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;
    @inject(IngotFeatureFlags) protected readonly flags: IngotFeatureFlags;
    @inject(IngotAccountService) protected readonly account: IngotAccountService;
    @inject(IngotModelClient) protected readonly models: IngotModelClient;
    @inject(AiCommitService) protected readonly aiCommit: AiCommitService;

    protected readonly cache = new Map<string, { at: number; parse: Promise<AgentHooksParse> }>();
    protected systemFiles?: Promise<HookFile[]>;

    get enabled(): boolean {
        return this.preferences.get<boolean>(AGENT_EVENT_HOOKS_PREF, true) !== false;
    }

    /** Enterprise (MDM) files for the backend's OS, or the one folder named by INGOT_SYSTEM_HOOKS_DIR. */
    protected system(): Promise<HookFile[]> {
        this.systemFiles ??= (async () => {
            const override = (await this.env.getValue(SYSTEM_HOOKS_DIR_ENV).catch(() => undefined))?.value;
            const paths = override ? [`${override.replace(/[\\/]+$/, '')}/${USER_HOOKS_FILE}`] : SYSTEM_FILES[await this.app.getBackendOS().catch(() => OS.Type.Linux)];
            return paths.map(path => {
                const uri = URI.fromFilePath(path);
                return { uri, source: path, level: 'enterprise' as const, cwd: uri.parent.path.fsPath() };
            });
        })();
        return this.systemFiles;
    }

    get claudeEnabled(): boolean {
        return this.preferences.get<boolean>(CLAUDE_HOOKS_PREF, true) !== false;
    }

    /**
     * Every hooks file in merge order: enterprise, project, user, then Claude Code's settings files (project local, project,
     * user) while their preference is on. Team hooks come from the account, not a file.
     */
    async hookFiles(root: URI | undefined): Promise<HookFile[]> {
        const [system, imported, global, home, mode] = await Promise.all([
            this.system(), this.projectConfig.importedGlobalDir(), this.projectConfig.globalDir(), this.projectConfig.importHome(), this.projectConfig.cursorMode(root)
        ]);
        const claude: HookFile[] = this.claudeEnabled ? [
            ...(root ? CLAUDE_PROJECT_HOOK_FILES.map(file => ({ uri: root.resolve(file), source: file, level: 'claude' as const, claude: true })) : []),
            { uri: home.resolve(CLAUDE_USER_HOOK_FILE), source: `~/${CLAUDE_USER_HOOK_FILE}`, level: 'claude', claude: true }
        ] : [];
        return [
            ...system,
            ...(root ? agentHookFileNames(mode).map(file => ({ uri: root.resolve(file), source: file, level: 'project' as const })) : []),
            { uri: imported.resolve(USER_HOOKS_FILE), source: `~/${CONFIG_DIRS.external}/${USER_HOOKS_FILE}`, level: 'user', cwd: imported.path.fsPath() },
            { uri: global.resolve(USER_HOOKS_FILE), source: `~/${CONFIG_DIRS.ingot}/${USER_HOOKS_FILE}`, level: 'user', cwd: global.path.fsPath() },
            ...claude
        ];
    }

    async load(root: URI | undefined): Promise<AgentHooksParse> {
        const key = root?.toString() ?? '';
        const cached = this.cache.get(key);
        if (cached && Date.now() - cached.at < HOOK_FILES_TTL_MS) {
            return cached.parse;
        }
        const parse = this.read(root);
        this.cache.set(key, { at: Date.now(), parse });
        return parse;
    }

    protected async read(root: URI | undefined): Promise<AgentHooksParse> {
        const files = await this.hookFiles(root);
        const parsed = await Promise.all(files.map(async file => {
            const text = await this.files.read(file.uri).then(r => r.value, () => undefined);
            return file.claude ? parseClaudeHooks(text, file) : parseAgentHooks(text, file.source, file.cwd, file.level);
        }));
        const global = await this.projectConfig.globalDir();
        const team = parseHooksObject(this.flags.config<unknown>(TEAM_HOOKS_CONFIG_KEY, undefined), { source: TEAM_HOOKS_SOURCE, level: 'team', cwd: global.path.fsPath() });
        const ordered = [parsed.filter((_, i) => files[i].level === 'enterprise'), [team], parsed.filter((_, i) => files[i].level !== 'enterprise')].flat();
        return { config: mergeAgentHooks(...ordered.map(p => p.config)), errors: ordered.flatMap(p => p.errors) };
    }

    /** True when at least one hook listens to the event (callers skip building an expensive payload otherwise). */
    async has(event: AgentHookEvent, root: URI | undefined): Promise<boolean> {
        return this.enabled && !!(await this.load(root)).config[event]?.length;
    }

    protected base(root: URI | undefined, base: Omit<HookPayloadBase, 'roots' | 'version' | 'userEmail'>): HookPayloadBase {
        const cwd = root?.path.fsPath();
        const email = this.account.snapshot.user?.email;
        return { ...base, roots: cwd ? [cwd] : [], version: PRODUCT.version, ...(email ? { userEmail: email } : {}) };
    }

    /**
     * Runs every matching hook of the event; undefined when hooks are off or none match. Follow-ups of stop / subagentStop
     * hooks over their `loop_limit` are dropped before the responses merge.
     */
    async run(event: AgentHookEvent, root: URI | undefined, base: Omit<HookPayloadBase, 'roots' | 'version' | 'userEmail'>, data: Readonly<Record<string, unknown>>,
        options: HookRunOptions = {}): Promise<AgentHookOutcome | undefined> {
        const cwd = root?.path.fsPath();
        if (!this.enabled || (!cwd && event !== 'workspaceOpen')) {
            return undefined;
        }
        const value = hookMatchValue(event, data);
        const commands = ((await this.load(root)).config[event] ?? []).filter(hook => hookMatches(hook, value));
        if (!commands.length) {
            return undefined;
        }
        const payload = this.base(root, base);
        const stdin = hookPayload(event, payload, data);
        const input = JSON.stringify(stdin);
        const env = hookEnv(cwd ?? '', payload, options.sessionEnv);
        const results: HookCommandResult[] = [];
        for (const hook of commands) {
            const started = Date.now();
            const hookInput = hook.claudeEvent ? JSON.stringify(claudeHookPayload(stdin, hook.claudeEvent, cwd ?? '')) : input;
            const response = hook.type === 'prompt' ? await this.runPrompt(event, hook, hookInput) : await this.runCommand(event, hook, hookInput, cwd, env);
            const kept = response.followupMessage && !underLoopLimit(hook, options.loopCount ?? 0) ? { ...response, followupMessage: undefined } : response;
            results.push({ command: hook.type === 'prompt' ? `prompt: ${hook.command}` : hook.command, durationMs: Date.now() - started, ...kept });
        }
        return hookOutcome(event, results);
    }

    protected async runCommand(event: AgentHookEvent, hook: AgentHookCommand, input: string, cwd: string | undefined, env: Record<string, string>): Promise<HookResponse> {
        const dir = hook.cwd ?? cwd;
        if (!dir) {
            return parseHookOutput(event, { stdout: '', stderr: 'No folder to run the hook in.', exitCode: 1, timedOut: false }, hook.failClosed);
        }
        const output = await this.processes.runHook({ cwd: dir, projectDir: cwd ?? dir, command: hook.command, input, env, timeoutMs: hook.timeoutSeconds * HOOK_MS_PER_SECOND })
            .catch((error: unknown) => ({ stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 1, timedOut: false }));
        return parseHookOutput(event, output, hook.failClosed);
    }

    /** `"type": "prompt"`: a fast model judges the input; it answers `{ "ok": boolean, "reason"? }`. */
    protected async runPrompt(event: AgentHookEvent, hook: AgentHookCommand, input: string): Promise<HookResponse> {
        const model = hook.model && this.models.isModelConfigured(hook.model) ? hook.model : this.aiCommit.pickModel();
        const failed = (stderr: string, timedOut = false): HookResponse => parseHookOutput(event, { stdout: '', stderr, exitCode: timedOut ? undefined : 1, timedOut }, hook.failClosed);
        if (!model) {
            return failed('No model is ready for prompt hooks.');
        }
        const stream = this.models.stream(model, [{ role: 'system', content: PROMPT_HOOK_SYSTEM }, { role: 'user', content: promptHookText(hook.command, input) }], () => undefined,
            { feature: 'agent_hook', maxTokens: PROMPT_HOOK_MAX_TOKENS, temperature: 0 });
        let timer: ReturnType<typeof setTimeout> | undefined;
        const timeout = new Promise<undefined>(resolve => { timer = setTimeout(() => resolve(undefined), hook.timeoutSeconds * HOOK_MS_PER_SECOND); });
        try {
            const answer = await Promise.race([stream.done, timeout]);
            if (answer === undefined) {
                stream.cancel();
                return failed('', true);
            }
            return parsePromptHookAnswer(event, answer, hook.failClosed);
        } catch (error) {
            return failed(error instanceof Error ? error.message : String(error));
        } finally {
            clearTimeout(timer);
        }
    }
}
