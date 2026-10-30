import type { Command } from '@theia/core/lib/common/command';

export const THREADS_WIDGET_ID = 'ingot-threads';
export const THREADS_LABEL = 'Threads';

export const THREADS_COMMANDS = {
    toggle: { id: 'ingot.threads.toggle', label: 'Threads', category: 'View' },
    newWorktree: { id: 'ingot.threads.newWorktree', label: 'New Thread in Git Worktree', category: 'Agents' }
} as const satisfies Record<string, Command>;

export const THREADS_TEXT = {
    newThread: 'New thread',
    newWorktree: 'New thread in a git worktree',
    empty: 'No threads yet. Start one with + and run several at once.',
    running: 'running',
    open: 'Open',
    unseen: 'Finished since you last looked',
    noFolder: 'Open a project folder to start a thread in a git worktree.',
    worktreeFailed: 'Could not create a git worktree',
    worktreeMade: 'New thread works in a git worktree'
} as const;

export const THREAD_STATE_ICONS = {
    running: 'codicon-loading codicon-modifier-spin',
    review: 'codicon-circle-filled',
    done: 'codicon-check',
    error: 'codicon-error',
    idle: 'codicon-circle-outline'
} as const;

/** "Thread finished" and "worktree created" toasts hide after this; errors stay until dismissed. */
export const THREADS_TOAST_MS = 8_000;

/** How often relative times in the list refresh. */
export const THREADS_CLOCK_MS = 30_000;
