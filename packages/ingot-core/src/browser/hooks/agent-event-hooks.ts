import { inject, injectable } from '@theia/core/shared/inversify';
import URI from '@theia/core/lib/common/uri';
import { PreferenceService } from '@theia/core/lib/common/preferences';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { ProcessService } from '../../common/processes/processes.types';
import { AGENT_HOOK_FILES } from '../../common/hooks/agent-hooks.consts';
import type { AgentHookEvent, AgentHookOutcome, AgentHooksParse, HookCommandResult } from '../../common/hooks/agent-hooks.types';
import { combineDecisions, hookPayload, mergeAgentHooks, parseAgentHooks, parseHookOutput, type HookPayloadBase } from '../../common/hooks/agent-hooks.utils';
import { AGENT_EVENT_HOOKS_PREF } from './hooks.consts';

/**
 * IDEA-294: Cursor-style agent hooks. Commands listed under `"hooks"` in `.ingot/hooks.json` (and `.cursor/hooks.json`)
 * run on agent events with the event as JSON on stdin; before-events answer allow / deny / ask. The git stages of the
 * same file keep running through AgentHooksService.
 */
@injectable()
export class AgentEventHooks {

    @inject(FileService) protected readonly files: FileService;
    @inject(ProcessService) protected readonly processes: ProcessService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;

    get enabled(): boolean {
        return this.preferences.get<boolean>(AGENT_EVENT_HOOKS_PREF, true) !== false;
    }

    async load(root: URI): Promise<AgentHooksParse> {
        const parsed = await Promise.all(AGENT_HOOK_FILES.map(async file => {
            const text = await this.files.read(root.resolve(file)).then(r => r.value, () => undefined);
            return parseAgentHooks(text, file);
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
            const output = await this.processes.runHook({ cwd, command: hook.command, input, timeoutMs: hook.timeoutSeconds * 1000 })
                .catch((error: unknown) => ({ stdout: '', stderr: error instanceof Error ? error.message : String(error), exitCode: 1, timedOut: false }));
            results.push({ command: hook.command, durationMs: Date.now() - started, ...parseHookOutput(event, output) });
        }
        return { event, decision: combineDecisions(results), results };
    }
}
