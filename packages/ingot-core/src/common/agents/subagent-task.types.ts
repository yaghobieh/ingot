export interface TaskRequest {
    readonly description: string;
    readonly prompt: string;
    readonly worktree: boolean;
}

/** What the parent gets back from a finished subagent. */
export interface TaskOutcome {
    readonly title: string;
    readonly status: 'done' | 'review' | 'error' | 'stopped';
    readonly reply: string;
    readonly files: readonly string[];
    /** Folder and branch when the subagent ran in its own git worktree. */
    readonly worktree?: { readonly path: string; readonly branch: string };
    readonly error?: string;
}
