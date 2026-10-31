import { ASK_USER_TOOL } from './chat-round.consts';
import { WORKSPACE_TOOL_NAMES } from './workspace-tools';

/** Built-in tools that only read: project files, git status / diff / log and questions to the user. */
export const READ_ONLY_TOOLS: readonly string[] = [...WORKSPACE_TOOL_NAMES, ASK_USER_TOOL];
export const READ_ONLY_GIT_OPS: readonly string[] = ['status', 'diff', 'log'];
export const GIT_TOOL = 'git';
