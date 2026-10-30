import type { AGENT_HOOK_EVENTS } from './agent-hooks.consts';

/** IDEA-294: agent lifecycle events a `hooks.json` command can watch, named as in Cursor. */
export type AgentHookEvent = typeof AGENT_HOOK_EVENTS[number];

export type HookPermission = 'allow' | 'deny' | 'ask';

export interface AgentHookCommand {
    readonly command: string;
    readonly timeoutSeconds: number;
    /** `.ingot/hooks.json` or `.cursor/hooks.json`. */
    readonly source: string;
}

export type AgentHooksConfig = Readonly<Partial<Record<AgentHookEvent, readonly AgentHookCommand[]>>>;

export interface AgentHooksParse {
    readonly config: AgentHooksConfig;
    readonly errors: readonly string[];
}

/** What a hook command answered (JSON on stdout), or what Ingot made of a failure. */
export interface HookDecision {
    readonly permission: HookPermission;
    readonly userMessage?: string;
    readonly agentMessage?: string;
}

/** One command's run, as reported back from the backend. */
export interface HookRunOutput {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode?: number;
    readonly timedOut: boolean;
}

export interface HookCommandResult extends HookDecision {
    readonly command: string;
    readonly durationMs: number;
}

export interface AgentHookOutcome {
    readonly event: AgentHookEvent;
    readonly decision: HookDecision;
    readonly results: readonly HookCommandResult[];
}
