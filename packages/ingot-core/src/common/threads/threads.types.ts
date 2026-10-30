import type { AgentStatus } from '../agents/agents.types';

/** IDEA-268: how a thread shows in the Threads sidebar. */
export type ThreadState = 'running' | 'review' | 'done' | 'error' | 'idle';

/** A chat isolated in its own git worktree: the folder (file URI) and the branch made for it. */
export interface ThreadWorktree {
    readonly path: string;
    readonly branch: string;
}

/** The parts of a chat the sidebar needs. */
export interface ThreadInput {
    readonly id: string;
    readonly title: string;
    readonly status: AgentStatus;
    readonly updatedAt: number;
    readonly messageCount: number;
    readonly running: boolean;
    readonly unseen: boolean;
    readonly project?: string;
    readonly worktree?: ThreadWorktree;
}

export interface ThreadRow {
    readonly id: string;
    readonly title: string;
    readonly state: ThreadState;
    readonly updatedAt: number;
    readonly unseen: boolean;
    readonly branch?: string;
}

export interface ThreadGroup {
    /** Project root URI ('' when no folder is open). */
    readonly key: string;
    readonly label: string;
    readonly rows: readonly ThreadRow[];
}

/** Backend answer for a new worktree: the absolute folder and its branch. */
export interface WorktreeCreated {
    readonly folder: string;
    readonly branch: string;
}
