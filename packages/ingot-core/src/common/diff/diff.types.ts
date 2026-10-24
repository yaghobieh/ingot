export interface DiffHunk {
    /** Zero-based line in the new text where the hunk starts. */
    readonly newStart: number;
    readonly removed: readonly string[];
    readonly added: readonly string[];
}

export interface DiffStats {
    readonly added: number;
    readonly removed: number;
}
