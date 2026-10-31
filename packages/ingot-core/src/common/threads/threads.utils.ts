import type { AgentStatus } from '../agents/agents.types';
import {
    NO_PROJECT_LABEL, THREAD_STATE_LABELS, WORKTREE_BRANCH_PREFIX, WORKTREE_DIR_SUFFIX, WORKTREE_FALLBACK_NAME, WORKTREE_NAME_PATTERN, WORKTREE_SLUG_MAX,
    WORKTREE_SUFFIX_CHARS
} from './threads.consts';
import type { ThreadGroup, ThreadInput, ThreadRow, ThreadState } from './threads.types';

const NEEDS_YOU: readonly AgentStatus[] = ['review', 'paused', 'approval'];

/** Running beats everything; a chat waiting on the user needs review; a finished reply is done. */
export const threadState = (status: AgentStatus, running: boolean, messageCount: number): ThreadState => {
    if (running) {
        return 'running';
    }
    if (NEEDS_YOU.includes(status)) {
        return 'review';
    }
    if (status === 'error') {
        return 'error';
    }
    return messageCount ? 'done' : 'idle';
};

/** Last folder name of a file URI or path. */
export const projectLabel = (uri: string): string => {
    const parts = uri.replace(/[\\/]+$/, '').split(/[\\/]/);
    const last = parts[parts.length - 1] ?? '';
    return decodeURIComponent(last);
};

/** Threads grouped by project: the open project first, then the rest by name; newest thread first in each group. */
export const groupThreads = (threads: readonly ThreadInput[], openProject: string | undefined): ThreadGroup[] => {
    const groups = new Map<string, ThreadRow[]>();
    for (const thread of [...threads].sort((a, b) => b.updatedAt - a.updatedAt)) {
        const key = thread.project ?? openProject ?? '';
        const row: ThreadRow = {
            id: thread.id, title: thread.title, updatedAt: thread.updatedAt, unseen: thread.unseen,
            state: threadState(thread.status, thread.running, thread.messageCount),
            ...(thread.worktree ? { branch: thread.worktree.branch } : {})
        };
        groups.set(key, [...(groups.get(key) ?? []), row]);
    }
    return [...groups.entries()]
        .map(([key, rows]) => ({ key, label: key ? projectLabel(key) : NO_PROJECT_LABEL, rows }))
        .sort((a, b) => Number(b.key === openProject) - Number(a.key === openProject) || a.label.localeCompare(b.label));
};

/** Ids that were running before and are not anymore. */
export const finishedThreads = (before: ReadonlySet<string>, now: ReadonlySet<string>): string[] => [...before].filter(id => !now.has(id));

/** Folder and branch name for a thread's worktree: a slug of its title plus a short piece of its id. */
export const worktreeName = (title: string, id: string): string => {
    const slug = title.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-+|-+$/g, '').slice(0, WORKTREE_SLUG_MAX).replace(/-+$/, '');
    const suffix = id.toLowerCase().replace(/[^a-z0-9]/g, '').slice(-WORKTREE_SUFFIX_CHARS);
    return [slug || WORKTREE_FALLBACK_NAME, suffix].filter(Boolean).join('-');
};

export const isValidWorktreeName = (name: string): boolean => WORKTREE_NAME_PATTERN.test(name);

export const worktreeBranch = (name: string): string => `${WORKTREE_BRANCH_PREFIX}${name}`;

/** `<parent>/<repo>.worktrees/<name>` for a repo at `<parent>/<repo>` (either separator). */
export const worktreeFolder = (repoTop: string, name: string): string => {
    const top = repoTop.replace(/[\\/]+$/, '');
    const cut = Math.max(top.lastIndexOf('/'), top.lastIndexOf('\\'));
    const sep = top[cut] ?? '/';
    return `${top.slice(0, cut)}${sep}${top.slice(cut + 1)}${WORKTREE_DIR_SUFFIX}${sep}${name}`;
};

/** Toast text when a thread stops running. */
export const finishMessage = (title: string, state: ThreadState, pendingFiles: number): string => {
    if (state === 'error') {
        return `"${title}" stopped with an error.`;
    }
    if (pendingFiles) {
        return `"${title}" finished. ${pendingFiles} ${pendingFiles === 1 ? 'file' : 'files'} to review.`;
    }
    return `"${title}" finished.`;
};

export const threadStateLabel = (state: ThreadState): string => THREAD_STATE_LABELS[state];
