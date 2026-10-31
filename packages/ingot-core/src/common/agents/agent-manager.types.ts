export type ManagerState = 'running' | 'approval' | 'question' | 'paused' | 'review' | 'error' | 'done' | 'idle';

/** One line of the Agent Manager: a chat or one of its subagents. */
export interface ManagerRow {
    readonly id: string;
    readonly title: string;
    readonly depth: number;
    readonly state: ManagerState;
    readonly step: string;
    readonly who: 'ingot' | 'zaprex';
    readonly parent?: string;
    readonly approval?: { readonly id: string; readonly line: string };
    /** Subagent that runs in its own git worktree. */
    readonly worktree?: string;
}

export interface ApprovalEntry {
    readonly sessionId: string;
    readonly approvalId: string;
    readonly title: string;
    readonly line: string;
    readonly askedAt: number;
}

export interface ManagerCounts {
    readonly running: number;
    readonly approvals: number;
    readonly total: number;
}
