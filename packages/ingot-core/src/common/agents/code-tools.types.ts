/** IDEA-259: language-server tools for the agent (definition, references, rename, organize imports, diagnostics). */

export type CodeToolName = 'go_to_definition' | 'find_references' | 'rename_symbol' | 'organize_imports' | 'diagnostics';

/** 1-based, like Monaco. */
export interface CodePosition {
    readonly line: number;
    readonly column: number;
}

/** 1-based, end exclusive, like a Monaco range. */
export interface CodeRange {
    readonly startLine: number;
    readonly startColumn: number;
    readonly endLine: number;
    readonly endColumn: number;
}

export interface CodeTextEdit {
    readonly range: CodeRange;
    readonly text: string;
}

/** A definition or reference, with its project-relative path and the text of its line. */
export interface CodeLocation {
    readonly path: string;
    readonly range: CodeRange;
    readonly preview: string;
}

export type CodeSeverity = 'error' | 'warning' | 'info' | 'hint';

export interface CodeDiagnostic {
    readonly path: string;
    readonly line: number;
    readonly column: number;
    readonly severity: CodeSeverity;
    readonly message: string;
    readonly source?: string;
    readonly code?: string;
}

/** Where the agent points: a file plus a symbol name (optionally on a line) or an exact line and column. */
export interface SymbolTarget {
    readonly path: string;
    readonly symbol?: string;
    readonly line?: number;
    readonly column?: number;
}

/** Text edits per project-relative path. */
export type FileEdits = ReadonlyMap<string, readonly CodeTextEdit[]>;
