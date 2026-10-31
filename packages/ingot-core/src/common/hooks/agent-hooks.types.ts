import type { AGENT_HOOK_EVENTS } from './agent-hooks.consts';

/** IDEA-294: agent lifecycle events a `hooks.json` command can watch, named as in Cursor. */
export type AgentHookEvent = typeof AGENT_HOOK_EVENTS[number];

export type HookPermission = 'allow' | 'deny' | 'ask';

/** IDEA-287: where a hook comes from. Responses merge in this order (enterprise first, user last). */
export type HookLevel = 'enterprise' | 'team' | 'project' | 'user';

export interface AgentHookCommand {
    /** The shell command; for a prompt hook, the prompt. */
    readonly command: string;
    readonly timeoutSeconds: number;
    /** `.ingot/hooks.json` or `.cursor/hooks.json` (or a user-level / system-wide file). */
    readonly source: string;
    /** IDEA-287: folder the command runs in; the project root when absent (user-level hooks run from their own folder). */
    readonly cwd?: string;
    /** IDEA-287: `"type": "prompt"` asks a model instead of running a command. */
    readonly type?: 'command' | 'prompt';
    /** Model of a prompt hook (the default fast model when absent). */
    readonly model?: string;
    /** Regex the event's match value must match (`""` / `"*"` match everything). */
    readonly matcher?: string;
    /** Failures (crash, timeout, bad exit, no output) block instead of letting the action through. */
    readonly failClosed?: boolean;
    /** Follow-ups a stop / subagentStop hook may send per chat; `null` is no limit. */
    readonly loopLimit?: number | null;
    readonly level?: HookLevel;
}

export type AgentHooksConfig = Readonly<Partial<Record<AgentHookEvent, readonly AgentHookCommand[]>>>;

export interface AgentHooksParse {
    readonly config: AgentHooksConfig;
    readonly errors: readonly string[];
}

/** Where a hooks file lives and how its commands run. */
export interface HookFileSource {
    readonly source: string;
    readonly level: HookLevel;
    readonly cwd?: string;
}

/** What a hook command answered (JSON on stdout), or what Ingot made of a failure. */
export interface HookDecision {
    readonly permission: HookPermission;
    readonly userMessage?: string;
    readonly agentMessage?: string;
}

/** IDEA-287: the non-permission fields of Cursor's hook responses. */
export interface HookResponseExtras {
    /** beforeSubmitPrompt: `false` keeps the prompt from being sent. */
    readonly continue?: boolean;
    /** stop / subagentStop: sent as the next user message. */
    readonly followupMessage?: string;
    /** sessionStart / postToolUse / postToolUseFailure: added to the conversation. */
    readonly additionalContext?: string;
    /** sessionStart: environment for the chat's later hooks. */
    readonly env?: Readonly<Record<string, string>>;
    /** preToolUse: the tool input to use instead. */
    readonly updatedInput?: Readonly<Record<string, unknown>>;
    /** postToolUse (MCP tools): replaces the result the model sees. */
    readonly updatedMcpToolOutput?: unknown;
}

export interface HookResponse extends HookDecision, HookResponseExtras {}

/** One command's run, as reported back from the backend. */
export interface HookRunOutput {
    readonly stdout: string;
    readonly stderr: string;
    readonly exitCode?: number;
    readonly timedOut: boolean;
}

export interface HookCommandResult extends HookResponse {
    readonly command: string;
    readonly durationMs: number;
}

export interface AgentHookOutcome {
    readonly event: AgentHookEvent;
    readonly decision: HookDecision;
    readonly results: readonly HookCommandResult[];
    /** IDEA-287: the merged extras of every command (deny > ask > allow; messages joined; other fields: last wins). */
    readonly extras: HookResponseExtras;
}

/** The common fields every hook gets on stdin (Cursor's names). */
export interface HookPayloadBase {
    readonly conversationId?: string;
    readonly generationId?: string;
    readonly roots: readonly string[];
    readonly model?: string;
    readonly version?: string;
    readonly userEmail?: string;
}
