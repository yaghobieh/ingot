import { AGENT_HOOK_EVENTS, AGENT_HOOK_MAX_TIMEOUT_SECONDS, AGENT_HOOK_TIMEOUT_SECONDS, GATING_HOOK_EVENTS, HOOK_DENY_EXIT_CODE } from './agent-hooks.consts';
import type {
    AgentHookCommand, AgentHookEvent, AgentHookOutcome, AgentHooksConfig, AgentHooksParse, HookCommandResult, HookDecision, HookPermission, HookRunOutput
} from './agent-hooks.types';

const PERMISSIONS: readonly string[] = ['allow', 'deny', 'ask'];
const RANK: Record<HookPermission, number> = { allow: 0, ask: 1, deny: 2 };

export const isAgentHookEvent = (name: string): name is AgentHookEvent => (AGENT_HOOK_EVENTS as readonly string[]).includes(name);
export const isGatingEvent = (event: AgentHookEvent): boolean => GATING_HOOK_EVENTS.includes(event);

/**
 * Reads the `"hooks"` section of a hooks file in Cursor's format:
 * `{ "version": 1, "hooks": { "beforeShellExecution": [{ "command": "./check.sh", "timeout": 10 }] } }`.
 * Git stages (`pre-commit`, `pre-push`) in the same file are left to the git hooks; bad entries become errors.
 */
export const parseAgentHooks = (text: string | undefined, source: string): AgentHooksParse => {
    if (!text?.trim()) {
        return { config: {}, errors: [] };
    }
    let raw: unknown;
    try {
        raw = JSON.parse(text);
    } catch (error) {
        return { config: {}, errors: [`${source} is not valid JSON: ${error instanceof Error ? error.message : String(error)}`] };
    }
    const hooks = (raw as { hooks?: unknown } | null)?.hooks;
    if (hooks === undefined) {
        return { config: {}, errors: [] };
    }
    if (!hooks || typeof hooks !== 'object' || Array.isArray(hooks)) {
        return { config: {}, errors: [`${source}: "hooks" must be an object of event → commands.`] };
    }
    const errors: string[] = [];
    const config: Partial<Record<AgentHookEvent, AgentHookCommand[]>> = {};
    for (const [event, list] of Object.entries(hooks as Record<string, unknown>)) {
        if (!isAgentHookEvent(event)) {
            errors.push(`${source}: unknown hook event "${event}" (use ${AGENT_HOOK_EVENTS.join(', ')}).`);
            continue;
        }
        if (!Array.isArray(list)) {
            errors.push(`${source}: "${event}" must be a list of commands.`);
            continue;
        }
        config[event] = list.flatMap((item: unknown, i): AgentHookCommand[] => {
            const entry = typeof item === 'string' ? { command: item } : item as Record<string, unknown> | null;
            const command = typeof entry?.command === 'string' ? entry.command.trim() : '';
            if (!command) {
                errors.push(`${source}: "${event}" entry ${i + 1} needs a "command".`);
                return [];
            }
            const timeout = typeof entry?.timeout === 'number' && entry.timeout > 0 ? Math.min(entry.timeout, AGENT_HOOK_MAX_TIMEOUT_SECONDS) : AGENT_HOOK_TIMEOUT_SECONDS;
            return [{ command, timeoutSeconds: timeout, source }];
        });
    }
    return { config, errors };
};

/** Commands of every file run, in file order. */
export const mergeAgentHooks = (...configs: readonly AgentHooksConfig[]): AgentHooksConfig => {
    const merged: Partial<Record<AgentHookEvent, AgentHookCommand[]>> = {};
    for (const config of configs) {
        for (const event of AGENT_HOOK_EVENTS) {
            if (config[event]?.length) {
                merged[event] = [...(merged[event] ?? []), ...config[event]!];
            }
        }
    }
    return merged;
};

const lastJsonObject = (text: string): Record<string, unknown> | undefined => {
    const candidates = [text.trim(), ...text.trim().split(/\r?\n/).reverse()];
    for (const candidate of candidates) {
        if (!candidate.startsWith('{')) {
            continue;
        }
        try {
            const value = JSON.parse(candidate) as unknown;
            if (value && typeof value === 'object' && !Array.isArray(value)) {
                return value as Record<string, unknown>;
            }
        } catch {
            // not JSON: try the next line
        }
    }
    return undefined;
};

const message = (json: Record<string, unknown>, camel: string, snake: string): string | undefined => {
    const value = json[camel] ?? json[snake];
    return typeof value === 'string' && value.trim() ? value.trim() : undefined;
};

/**
 * A command's answer. JSON `{ "permission": "allow" | "deny" | "ask", "userMessage"?, "agentMessage"? }` on stdout
 * (snake_case keys work too); exit code 2 denies. A gating hook that times out or fails asks the user instead of
 * silently allowing; notification events (afterFileEdit, stop) always allow.
 */
export const parseHookOutput = (event: AgentHookEvent, output: HookRunOutput): HookDecision => {
    const gating = isGatingEvent(event);
    if (output.timedOut) {
        return gating ? { permission: 'ask', userMessage: 'The hook timed out.' } : { permission: 'allow' };
    }
    const stderr = output.stderr.trim();
    if (output.exitCode === HOOK_DENY_EXIT_CODE) {
        return { permission: 'deny', userMessage: stderr || 'Blocked by a hook.', ...(stderr ? { agentMessage: stderr } : {}) };
    }
    const json = lastJsonObject(output.stdout);
    const permission = typeof json?.permission === 'string' && PERMISSIONS.includes(json.permission) ? json.permission as HookPermission : undefined;
    if (json && permission) {
        const user = message(json, 'userMessage', 'user_message');
        const agent = message(json, 'agentMessage', 'agent_message');
        return { permission: gating ? permission : 'allow', ...(user ? { userMessage: user } : {}), ...(agent ? { agentMessage: agent } : {}) };
    }
    if (output.exitCode !== undefined && output.exitCode !== 0 && gating) {
        return { permission: 'ask', userMessage: `The hook failed (exit ${output.exitCode})${stderr ? `: ${stderr.split('\n')[0]}` : '.'}` };
    }
    return { permission: 'allow' };
};

/** The strictest answer wins (deny > ask > allow); messages of the deciding commands are joined. */
export const combineDecisions = (decisions: readonly HookDecision[]): HookDecision => {
    const permission = decisions.reduce<HookPermission>((worst, d) => RANK[d.permission] > RANK[worst] ? d.permission : worst, 'allow');
    const deciding = decisions.filter(d => d.permission === permission);
    const join = (key: 'userMessage' | 'agentMessage'): string | undefined => deciding.map(d => d[key]).filter(Boolean).join('\n') || undefined;
    const user = join('userMessage');
    const agent = join('agentMessage');
    return { permission, ...(user ? { userMessage: user } : {}), ...(agent ? { agentMessage: agent } : {}) };
};

export interface HookPayloadBase {
    readonly conversationId: string;
    readonly generationId: string;
    readonly roots: readonly string[];
}

/** The JSON a command gets on stdin: Cursor's common fields plus the event's own. */
export const hookPayload = (event: AgentHookEvent, base: HookPayloadBase, data: Readonly<Record<string, unknown>>): Record<string, unknown> => ({
    conversation_id: base.conversationId,
    generation_id: base.generationId,
    hook_event_name: event,
    workspace_roots: [...base.roots],
    ...data
});

/** Tool result the agent gets when a hook blocks an action. */
export const hookBlockedText = (outcome: AgentHookOutcome): string =>
    `Blocked by a ${outcome.event} hook${outcome.decision.agentMessage ? `: ${outcome.decision.agentMessage}` : outcome.decision.userMessage ? `: ${outcome.decision.userMessage}` : '.'} Do not retry it unless the user asks.`;

/** The hook card body: one line per command with its answer. */
export const hookOutcomeText = (results: readonly HookCommandResult[]): string =>
    results.map(r => `${r.command} → ${r.permission}${r.userMessage ? `: ${r.userMessage}` : ''}`).join('\n');
