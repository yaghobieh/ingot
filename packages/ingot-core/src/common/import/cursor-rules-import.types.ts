import type { CURSOR_IMPORT_MODES } from './cursor-rules-import.consts';

export type CursorImportMode = typeof CURSOR_IMPORT_MODES[number];

/** A Cursor rule file found in the project (`.cursor/rules/<fileName>`). */
export interface CursorRuleFile {
    readonly fileName: string;
    readonly text: string;
}

/** What the project has today, read by the browser before planning. */
export interface CursorImportInput {
    readonly rules: readonly CursorRuleFile[];
    /** Content of `.cursorrules`, when the project has one. */
    readonly cursorrules?: string;
    /** File names already in `.ingot/rules`. */
    readonly ingotRules: readonly string[];
}

/** A file to write under `.ingot/rules`, with the Cursor file it came from. */
export interface ImportedRule {
    readonly fileName: string;
    readonly text: string;
    readonly from: string;
}
