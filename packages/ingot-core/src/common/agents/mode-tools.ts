import { modeInfo } from './agent-modes';
import type { AgentToolCall } from './agent-protocol';
import { BUILTIN_TOOL_SERVER } from './agent-actions';
import type { AgentMode } from './agents.types';
import { GIT_TOOL, READ_ONLY_GIT_OPS, READ_ONLY_TOOLS } from './mode-tools.consts';

/** True for a call that only reads (project files, git status / diff / log, a question to the user). */
export const isReadOnlyCall = (call: Pick<AgentToolCall, 'server' | 'tool' | 'args'>): boolean =>
    call.server === BUILTIN_TOOL_SERVER
    && (READ_ONLY_TOOLS.includes(call.tool) || (call.tool === GIT_TOOL && READ_ONLY_GIT_OPS.includes(String(call.args.op ?? ''))));

/**
 * IDEA-265: modes with tools may call every tool; Ask and Plan only read, even when the model emits a call anyway.
 * IDEA-287: a read-only custom subagent only reads too, whatever its mode.
 */
export const toolAllowedInMode = (mode: AgentMode, call: Pick<AgentToolCall, 'server' | 'tool' | 'args'>, readOnly = false): boolean =>
    (modeInfo(mode).canUseTools && !readOnly) || isReadOnlyCall(call);

/** The tool result the model gets when its mode refuses a call. */
export const modeBlockedResult = (mode: AgentMode, call: Pick<AgentToolCall, 'server' | 'tool'>): string =>
    `${modeInfo(mode).label} mode is read-only: ${call.server}/${call.tool} is not available. Answer from what you can read, or ask the user to switch to Agent mode.`;
