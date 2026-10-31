import type { AgentToolCall } from './agent-protocol';
import { BUILTIN_TOOL_SERVER } from './agent-actions';
import { SUBAGENT_MARKER, TASK_SUMMARY_CHARS, TASK_TITLE_MAX, TASK_TOOL, WORKTREE_BRANCH_PREFIX, WORKTREE_NAME } from './subagent-task.consts';
import type { TaskOutcome, TaskRequest } from './subagent-task.types';
import { subagentTypeArg } from './custom-subagents.utils';

export const isTaskCall = (call: AgentToolCall): boolean => call.server === BUILTIN_TOOL_SERVER && call.tool === TASK_TOOL;

const oneLine = (text: string): string => text.replace(/\s+/g, ' ').trim();

/** Validates `ingot/task` arguments. The title falls back to the start of the prompt. */
export const parseTaskArgs = (args: Record<string, unknown>): TaskRequest | { error: string } => {
    const prompt = typeof args.prompt === 'string' ? args.prompt.trim() : '';
    if (!prompt) {
        return { error: 'A task needs a "prompt" with everything the subagent must know.' };
    }
    const raw = oneLine(typeof args.description === 'string' && args.description.trim() ? args.description : prompt);
    const description = raw.length > TASK_TITLE_MAX ? `${raw.slice(0, TASK_TITLE_MAX - 1).trimEnd()}…` : raw;
    const agent = subagentTypeArg(args);
    return { description, prompt, worktree: args.worktree === true, ...(agent ? { agent } : {}) };
};

/** The only message a subagent starts with (clean context: none of the parent chat). */
export const taskChildPrompt = (task: TaskRequest, worktree?: { path: string; branch: string }, instructions = ''): string => [
    instructions ? `${instructions}\n` : '',
    task.prompt,
    '',
    `${SUBAGENT_MARKER} Another agent gave you this task; it sees only your final reply.`,
    worktree ? `You work in a separate git worktree on branch ${worktree.branch} (${worktree.path}); your edits stay there.` : '',
    'Do only this task. End with a short summary: what you found or changed, and the files.'
].filter(Boolean).join('\n');

/** `ingot/task-<slug>` for the worktree branch; the slug is short, lower case and unique per chat id. */
export const worktreeName = (childId: string): string => {
    const slug = childId.toLowerCase().replace(/[^a-z0-9-]+/g, '-').replace(/^-+|-+$/g, '').slice(-TASK_TITLE_MAX);
    return WORKTREE_NAME.test(slug) ? slug : `task-${Date.now().toString(36)}`;
};

export const worktreeBranch = (name: string): string => `${WORKTREE_BRANCH_PREFIX}${name}`;

/** The tool result the parent reads. */
export const taskResultText = (outcome: TaskOutcome): string => {
    const reply = outcome.reply.trim();
    const body = reply.length > TASK_SUMMARY_CHARS ? `${reply.slice(0, TASK_SUMMARY_CHARS)}…` : reply;
    const status = outcome.status === 'review' ? 'done, edits wait for the user\'s review' : outcome.status;
    return [
        `Subagent "${outcome.title}" ${status}.`,
        outcome.worktree ? `Worktree: ${outcome.worktree.path} (branch ${outcome.worktree.branch}).` : '',
        outcome.files.length ? `Files: ${outcome.files.join(', ')}` : '',
        outcome.error ? `Error: ${outcome.error}` : '',
        body ? `Summary:\n${body}` : 'It gave no summary.'
    ].filter(Boolean).join('\n');
};
