export interface InlineEditRequest {
    /** Project-relative path. */
    readonly path: string;
    readonly languageId: string;
    readonly instruction: string;
    readonly before: string;
    readonly selection: string;
    readonly after: string;
}

/** One-based, inclusive line span of an edit (always whole lines). */
export interface LineSpan {
    readonly startLine: number;
    readonly endLine: number;
}
