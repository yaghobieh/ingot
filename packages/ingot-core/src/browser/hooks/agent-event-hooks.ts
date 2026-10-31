import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { ProcessService } from '../../common/processes/processes.types';
import { USER_HOOKS_FILE } from '../../common/hooks/agent-hooks.consts';
import type { AgentHookEvent, AgentHookOutcome, AgentHooksParse, HookCommandResult } from '../../common/hooks/agent-hooks.types';
import { combineDecisions, hookPayload, mergeAgentHooks, parseAgentHooks, parseHookOutput, type HookPayloadBase } from '../../common/hooks/agent-hooks.utils';
import { agentHookFileNames } from '../../common/import/cursor-mode.utils';
import { CONFIG_DIRS } from '../../common/project-config/project-config.consts';
import { ProjectConfigService } from '../project-config/project-config-service';
import { AGENT_EVENT_HOOKS_PREF } from './hooks.consts';

/**
 * IDEA-294: Cursor-style agent hooks. Commands listed under `"hooks"` in `.ingot/hooks.json` (and `.cursor/hooks.json`)
 * run on agent events with the event as JSON on stdin; before-events answer allow / deny / ask. The git stages of the
 * same file keep running through AgentHooksService. IDEA-287: user-level `~/.cursor/hooks.json` and `~/.ingot/hooks.json`
 * run too (from their own folder), and `.cursor/hooks.json` only while the workspace reads `.cursor` live.
 */
@injectable()
export class AgentEventHooks {

    @inject(FileService) protected readonly files: FileService;
    @inject(ProcessService) protected readonly processes: ProcessService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(ProjectConfigService) protected readonly projectConfig: ProjectConfigService;

    get enabled(): boolean {
        return this.preferences.get<boolean>(AGENT_EVENT_HOOKS_PREF, true) !== false;
    }

    protected async hookFiles(root: URI): Promise<{ uri: URI; source: string; cwd?: string }[]> {
        const [imported, global, mode] = await Promise.all([this.projectConfig.importedGlobalDir(), this.projectConfig.globalDir(), this.projectConfig.cursorMode(root)]);
        return [
            { uri: imported.resolve(USER_HOOKS_FILE), source: `~/${CONFIG_DIRS.external}/${USER_HOOKS_FILE}`, cwd: imported.path.fsPath() },
            { uri: global.resolve(USER_HOOKS_FILE), source: `~/${CONFIG_DIRS.ingot}/${USER_HOOKS_FILE}`, cwd: global.path.fsPath() },
            ...agentHookFileNames(mode).map(file => ({ uri: root.resolve(file), source: file }))
        ];
    }

    async load(root: URI): Promise<AgentHooksParse> {
        const parsed = await Promise.all((await this.hookFiles(root)).map(async file => {
            const text = await this.files.read(file.uri).then(r => r.value, () => undefined);
            return parseAgentHooks(text, file.source, file.cwd);
        }));
        return { config: mergeAgentHooks(...parsed.map(p => p.config)), errors: parsed.flatMap(p => p.errors) };
    }

    /** Runs every command for the event; undefined when hooks are off or none are configured. */
    async run(event: AgentHookEvent, root: URI | undefined, base: Omit<HookPayloadBase, 'roots'>, data: Readonly<Record<string, unknown>>): Promise<AgentHookOutcome | undefined> {
        const cwd = root?.path.fsPath();
        if (!this.enabled || !root || !cwd) {
            return undefined;
        }
        const commands = (await this.load(root)).config[event] ?? [];
        if (!commands.length) {
            return undefined;
        }
        const input = JSON.stringify(hookPayload(event, { ...base, roots: [cwd] }, data));
        const results: HookCommandResult[] = [];
        for (const hook of commands) {
            const started = Date.now();
            const output = await this.processes.runHook({ cwd: hook.cwd ?? cwd, projectDir: cwd, command: hook.command, input, timeoutMs: hook.timeoutSeconds * 1000 })
                .catch((error: unknown) => ({ stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 1, timedOut: false }));
            results.push({ command: hook.command, durationMs: Date.now() - started, ...parseHookOutput(event, output) });
        }
        return { event, decision: combineDecisions(results), results };
    }
}
