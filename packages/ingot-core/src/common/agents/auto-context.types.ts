/** IDEA-267: what the IDE attaches to a prompt by itself, shown as removable chips above the composer. */
export type AutoContextKind = 'file' | 'selection' | 'diagnostics' | 'edits' | 'diff' | 'memory';

export type DiagnosticSeverity = 'error' | 'warning' | 'info';

export interface AutoDiagnostic {
    readonly path: string;
    /** 1-based. */
    readonly line: number;
    readonly severity: DiagnosticSeverity;
    readonly message: string;
    readonly source?: string;
}

export interface AutoFile {
    /** Workspace-relative path. */
    readonly path: string;
    readonly uri: string;
    /** 1-based cursor line. */
    readonly cursorLine: number;
    /** The lines around the cursor, already cut to a window. */
    readonly excerpt: string;
    /** 1-based first line of `excerpt`. */
    readonly excerptStart: number;
    readonly lineCount: number;
}

export interface AutoSelection {
    readonly path: string;
    readonly uri: string;
    readonly start: number;
    readonly end: number;
    readonly text: string;
}

export interface AutoEdit {
    readonly path: string;
    /** Epoch ms of the last change to this file. */
    readonly at: number;
    /** 1-based lines touched, newest last (deduplicated). */
    readonly lines: readonly number[];
}

/** Everything the IDE knows at send time; the browser service fills it, pure code turns it into chips. */
export interface AutoContextSnapshot {
    readonly file?: AutoFile;
    readonly selection?: AutoSelection;
    readonly diagnostics: readonly AutoDiagnostic[];
    readonly edits: readonly AutoEdit[];
    /** `git diff HEAD` of the workspace (may be empty). */
    readonly diff: string;
    /** Memories that will be injected (count only; text comes from the memory store). */
    readonly memories: number;
}

export interface AutoContextItem {
    /** `kind:signature`; a dismissed key stays hidden until the underlying context changes. */
    readonly key: string;
    readonly kind: AutoContextKind;
    readonly label: string;
    /** Tooltip: what will be sent. */
    readonly title: string;
    /** The text the model sees (empty for `memory`: memories are formatted by the store). */
    readonly text: string;
    /** File to open when the chip is clicked. */
    readonly uri?: string;
    readonly line?: number;
}

/** What one send attaches: the chips left in the composer, and whether the user removed the memories chip. */
export interface AutoAttach {
    readonly items: readonly AutoContextItem[];
    readonly skipMemories: boolean;
}

/** A chip as kept on a sent message (no payload, so saved history stays small). */
export interface SentAutoContext {
    readonly kind: AutoContextKind;
    readonly label: string;
}

export interface DiffStat {
    readonly files: number;
    readonly added: number;
    readonly removed: number;
}
