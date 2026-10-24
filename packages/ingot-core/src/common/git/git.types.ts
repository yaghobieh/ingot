export interface GitBranch {
    readonly name: string;
    readonly current: boolean;
    readonly remote: boolean;
    readonly upstream?: string;
    readonly ahead?: number;
    readonly behind?: number;
}

export interface GitCommit {
    readonly hash: string;
    readonly short: string;
    readonly author: string;
    readonly date: string;
    readonly subject: string;
    readonly refs: readonly string[];
}

export type GitChangeStatus = 'A' | 'M' | 'D' | 'R' | 'C' | 'T' | 'U';

export interface GitFileChange {
    readonly status: GitChangeStatus;
    readonly path: string;
    readonly oldPath?: string;
}

export const GitService = Symbol('GitService');
/** Small, explicit Git surface for the Ingot UI (IDEA-32). `root` is the repository folder's file-system path. */
export interface GitService {
    branches(root: string): Promise<GitBranch[]>;
    checkout(root: string, branch: string): Promise<void>;
    createBranch(root: string, name: string): Promise<void>;
    log(root: string, limit: number, path?: string): Promise<GitCommit[]>;
    changes(root: string, hash: string): Promise<GitFileChange[]>;
    /** File content at a revision, or undefined when the file does not exist there. */
    show(root: string, ref: string, path: string): Promise<string | undefined>;
}
