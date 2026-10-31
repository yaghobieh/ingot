export type ArtifactKind = 'markdown' | 'image';

/** `run.json`: which chat and turn produced the folder. */
export interface ArtifactRunMeta {
    readonly runId: string;
    readonly sessionId: string;
    readonly title: string;
    readonly startedAt: number;
    readonly endedAt?: number;
}

/** A comment on one line of a markdown artifact, or on a whole image. */
export interface ArtifactComment {
    readonly id: string;
    /** Path inside the run folder, e.g. `plan.md` or `screenshots/shot-1.png`. */
    readonly file: string;
    /** 1-based line for markdown; absent for images. */
    readonly line?: number;
    /** The line (or image name) the comment points at, kept so it reads well after the file changes. */
    readonly quote: string;
    readonly text: string;
    readonly at: number;
    /** True once it reached the agent (steered into a run or started a new turn). */
    readonly sent: boolean;
}

export interface ArtifactFile {
    readonly name: string;
    readonly kind: ArtifactKind;
}

export interface MarkdownLine {
    readonly line: number;
    readonly text: string;
    /** Inside a ``` fence: shown as code, not as markdown. */
    readonly code: boolean;
}

export interface WalkthroughInput {
    readonly title: string;
    readonly prompt: string;
    readonly reply: string;
    readonly files: readonly string[];
    readonly plan: readonly string[];
    readonly screenshots: readonly string[];
}
