import { hookToolName } from './agent-hooks.utils';

/** IDEA-287: the event-specific stdin fields of Cursor's hooks, built from Ingot's agent loop. */
type Payload = Record<string, unknown>;

export interface HookToolCall {
    readonly server: string;
    readonly tool: string;
    readonly args: Readonly<Record<string, unknown>>;
}

export interface HookToolResult {
    readonly text: string;
    readonly isError?: boolean;
}

export type ToolFailureType = 'error' | 'timeout' | 'permission_denied';

/** How a hook card names a tool call. */
export const hookToolLabel = (call: HookToolCall): string => `${call.server}/${call.tool}`;

export const toolPayload = (call: HookToolCall, builtinServer: string, toolUseId: string, cwd?: string): Payload => ({
    tool_name: hookToolName(call.server, call.tool, builtinServer), tool_input: call.args, tool_use_id: toolUseId, ...(cwd ? { cwd } : {})
});

export const postToolPayload = (call: HookToolCall, builtinServer: string, toolUseId: string, result: HookToolResult, durationMs: number, cwd?: string): Payload => ({
    ...toolPayload(call, builtinServer, toolUseId, cwd), tool_output: JSON.stringify({ output: result.text, isError: !!result.isError }), duration: durationMs
});

export const toolFailurePayload = (call: HookToolCall, builtinServer: string, toolUseId: string, error: string, failure: ToolFailureType, durationMs: number, cwd?: string): Payload => ({
    ...toolPayload(call, builtinServer, toolUseId, cwd), error_message: error, failure_type: failure, duration: durationMs, is_interrupt: false
});

/** A failed tool's kind: a timeout, a block (hook, policy, sandbox) or a plain error. */
export const toolFailureType = (text: string, blocked: boolean): ToolFailureType => blocked ? 'permission_denied' : /timed out|timeout/i.test(text) ? 'timeout' : 'error';

export const shellPayload = (command: string, cwd?: string): Payload => ({ command, ...(cwd ? { cwd } : {}), sandbox: false });

export const afterShellPayload = (command: string, output: string, durationMs: number, sandboxed: boolean): Payload => ({ command, output, duration: durationMs, sandbox: sandboxed });

/** `server` is kept for hooks written against Ingot's first payload. */
export const mcpPayload = (call: HookToolCall, launch?: { readonly url?: string; readonly command?: string }): Payload => ({
    tool_name: call.tool, tool_input: JSON.stringify(call.args), mcp_server_name: call.server, server: call.server,
    ...(launch?.url ? { url: launch.url, mcp_server_url: launch.url } : launch?.command ? { command: launch.command } : {})
});

export const afterMcpPayload = (call: HookToolCall, result: HookToolResult, durationMs: number, url?: string): Payload => ({
    tool_name: call.tool, tool_input: JSON.stringify(call.args), mcp_server_name: call.server, ...(url ? { mcp_server_url: url } : {}),
    result_json: JSON.stringify({ content: [{ type: 'text', text: result.text }], isError: !!result.isError }), duration: durationMs
});

export interface CompactStats {
    readonly trigger: 'auto' | 'manual';
    readonly tokens: number;
    readonly window: number;
    readonly messageCount: number;
    readonly firstCompaction: boolean;
}

export const preCompactPayload = (stats: CompactStats): Payload => ({
    trigger: stats.trigger, context_usage_percent: stats.window > 0 ? Math.min(100, Math.round(stats.tokens / stats.window * 100)) : 0,
    context_tokens: stats.tokens, context_window_size: stats.window, message_count: stats.messageCount, messages_to_compact: stats.messageCount,
    is_first_compaction: stats.firstCompaction
});

export interface SubagentInfo {
    readonly id: string;
    readonly type: string;
    readonly task: string;
    readonly parentId: string;
    readonly model: string;
    readonly parallel: boolean;
    readonly branch?: string;
}

export const subagentStartPayload = (info: SubagentInfo): Payload => ({
    subagent_id: info.id, subagent_type: info.type, task: info.task, parent_conversation_id: info.parentId, tool_call_id: info.id,
    subagent_model: info.model, is_parallel_worker: info.parallel, ...(info.branch ? { git_branch: info.branch } : {})
});

export interface SubagentResult {
    readonly status: 'completed' | 'error' | 'aborted';
    readonly description: string;
    readonly summary: string;
    readonly durationMs: number;
    readonly messageCount: number;
    readonly toolCallCount: number;
    readonly loopCount: number;
    readonly files: readonly string[];
}

export const subagentStopPayload = (info: Pick<SubagentInfo, 'type' | 'task'>, result: SubagentResult): Payload => ({
    subagent_type: info.type, status: result.status, task: info.task, description: result.description, summary: result.summary,
    duration_ms: result.durationMs, message_count: result.messageCount, tool_call_count: result.toolCallCount, loop_count: result.loopCount,
    modified_files: [...result.files], agent_transcript_path: null
});

/** A hook's `additional_context`, as the hidden message the model reads after the step. */
export const hookContextText = (event: string, text: string): string => `Context from a ${event} hook:\n${text}`;
