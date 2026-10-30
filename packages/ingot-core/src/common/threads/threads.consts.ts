import type { ThreadState } from './threads.types';

/** Worktree branches are `ingot/<name>`; their folders sit next to the repo in `<repo>.worktrees/<name>`. */
export const WORKTREE_BRANCH_PREFIX = 'ingot/';
export const WORKTREE_DIR_SUFFIX = '.worktrees';
export const WORKTREE_NAME_PATTERN = /^[a-z0-9][a-z0-9-]{0,47}$/;
export const WORKTREE_SLUG_MAX = 32;
export const WORKTREE_SUFFIX_CHARS = 4;
export const WORKTREE_FALLBACK_NAME = 'thread';

export const NO_PROJECT_LABEL = 'No project';

export const THREAD_STATE_LABELS: Readonly<Record<ThreadState, string>> = {
    running: 'Running',
    review: 'Needs review',
    done: 'Done',
    error: 'Error',
    idle: 'New'
};
