/** A thumbs-up on a chat message. */
export const REACTION_LIKE = 'like';

/** A heart on a chat message. */
export const REACTION_HEART = 'heart';

export const REACTION_KINDS = [REACTION_LIKE, REACTION_HEART] as const;

/** Built-in tool that pauses the run until the user answers. */
export const ASK_USER_TOOL = 'ask_user';

export const THINKING_LABEL = 'Thinking…';
export const THOUGHT_LABEL = 'Thought';
export const THOUGHT_FOR_PREFIX = 'Thought for ';

export const THOUGHT_SECOND_MS = 1000;

export const ASK_STOPPED = 'Stopped while waiting for an answer.';

export const TAB_RUNNING = 'running';
export const TAB_WAITING = 'waiting';
export const TAB_DONE = 'done';
export const TAB_IDLE = 'idle';
