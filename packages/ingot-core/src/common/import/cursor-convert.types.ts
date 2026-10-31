import type { CURSOR_ITEM_LABELS } from './cursor-convert.consts';

export type CursorItemKind = keyof typeof CURSOR_ITEM_LABELS;

/** A Cursor file found in the workspace (project-relative path, forward slashes). Copied kinds need no text. */
export interface CursorSourceFile {
    readonly path: string;
    readonly text?: string;
}

export interface CursorConversionInput {
    readonly sources: readonly CursorSourceFile[];
    /** Project-relative paths that already exist: a target there is never overwritten (merge targets are merged). */
    readonly existing: readonly string[];
    /** Current text of the merge targets (`.ingot/mcp.json`, `.ingot/hooks.json`, `.ingotignore`, `.ingotindexingignore`). */
    readonly current: Readonly<Record<string, string>>;
}

export interface CursorConversionStep {
    readonly kind: CursorItemKind;
    readonly from: string;
    readonly target: string;
    /** The translated text. Absent: copy the file as is (scripts keep their mode). */
    readonly text?: string;
    /** The target exists and gets the merged text. */
    readonly merge?: boolean;
}

export interface CursorConversionPlan {
    readonly steps: readonly CursorConversionStep[];
    /** Files that could not be converted, with the reason (bad JSON and the like). */
    readonly skipped: readonly { readonly from: string; readonly reason: string }[];
}
