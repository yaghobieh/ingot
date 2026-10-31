/** IDEA-291: `ingot/task` starts a subagent with a clean context and returns its summary. */
export const TASK_TOOL = 'task';
export const TASK_TOOL_DESCRIPTION = 'Start a subagent for one self-contained piece of work. It starts with a clean context (only your prompt, not this chat), runs in parallel with other task calls in the same reply, and returns a summary. Arguments: {"description": "3-5 word title", "prompt": "everything it needs to know", "worktree"?: true, "subagent_type"?: "custom subagent name"}. worktree runs it in its own git worktree and branch, so its edits do not touch this checkout. subagent_type runs one of the custom subagents of the project (listed in the instructions when there are any). Runs at once.';
export const MAX_PARALLEL_TASKS = 4;
export const TASK_TITLE_MAX = 48;
export const TASK_SUMMARY_CHARS = 3_000;
/** Branch and folder prefix for a subagent worktree. */
export const WORKTREE_BRANCH_PREFIX = 'ingot/task-';
export const WORKTREE_NAME = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const SUBAGENT_MARKER = 'You are a subagent.';
export const NESTED_TASK_ERROR = 'Subagents cannot start their own subagents. Do the work yourself.';
export const TOO_MANY_TASKS = `At most ${MAX_PARALLEL_TASKS} subagents run at once; the rest were skipped. Call task again for them after these finish.`;
export const SUBAGENT_STEP_PREFIX = 'subagent ';
