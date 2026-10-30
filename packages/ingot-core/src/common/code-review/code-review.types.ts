/** IDEA-293: AI code review (Bugbot-like) of the local git diff or a GitHub pull request. */
export type ReviewSeverity = 'critical' | 'high' | 'medium' | 'low';

export interface ReviewFinding {
    readonly id: string;
    /** Project-relative path. */
    readonly path: string;
    /** 1-based line in the new version of the file. */
    readonly line: number;
    readonly severity: ReviewSeverity;
    readonly title: string;
    readonly detail: string;
}

/** One file of a unified diff. */
export interface DiffFile {
    readonly path: string;
    /** 1-based lines added or changed in the new version. */
    readonly added: readonly number[];
    /** The file's diff text (header and hunks). */
    readonly text: string;
    readonly deleted: boolean;
}

export interface DiffResult {
    readonly diff: string;
    /** "Local changes" or "PR #12 (owner/repo)". */
    readonly label: string;
    readonly error?: string;
}

export interface ReviewBudget {
    /** Characters of diff per model call. */
    readonly maxChunkChars: number;
    /** Model calls per review; files that do not fit are skipped and listed. */
    readonly maxCalls: number;
    readonly maxTokens: number;
    readonly maxFindings: number;
}

export interface ReviewOutcome {
    readonly findings: readonly ReviewFinding[];
    readonly reviewedFiles: readonly string[];
    /** Files left out to stay within the budget. */
    readonly skippedFiles: readonly string[];
    readonly calls: number;
    readonly errors: readonly string[];
}

/** The model behind the review; tests pass a fake. */
export interface ReviewModel {
    complete(system: string, user: string, maxTokens: number): Promise<string>;
}

export interface PullRequestRef {
    readonly number: number;
    /** `owner/repo` when the input named it (a PR URL). */
    readonly repo?: string;
}

export const CodeReviewService = Symbol('IngotCodeReviewService');

/** Backend: read-only diffs for review. Nothing here writes to the repository or to GitHub. */
export interface CodeReviewService {
    /** Staged, unstaged and untracked changes against HEAD. */
    localDiff(root: string): Promise<DiffResult>;
    /** A pull request's diff through the GitHub CLI, else the GitHub API with the user's token. */
    pullRequestDiff(root: string, ref: string): Promise<DiffResult>;
}
