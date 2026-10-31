import type { CursorItemKind } from './cursor-convert.types';

/** What the last sync wrote for one `.ingot` file: its Cursor source and both hashes at that time. */
export interface CursorSyncRecord {
    readonly from: string;
    readonly source: string;
    readonly target: string;
}

/** Records of one workspace, by target path. */
export type CursorSyncManifest = Readonly<Record<string, CursorSyncRecord>>;

/** A converted file as the Cursor config is now: the translated text (absent: copied as is) and the source hash. */
export interface CursorSyncItem {
    readonly kind: CursorItemKind;
    readonly from: string;
    readonly target: string;
    readonly text?: string;
    readonly sourceHash: string;
}

export interface CursorSyncInput {
    readonly items: readonly CursorSyncItem[];
    readonly manifest: CursorSyncManifest;
    /** Hash of each target as it is now; undefined when the file does not exist. */
    readonly targets: Readonly<Record<string, string | undefined>>;
}

export type CursorSyncAction = 'add' | 'update' | 'remove';

export interface CursorSyncChange {
    readonly action: CursorSyncAction;
    readonly from: string;
    readonly target: string;
    readonly kind?: CursorItemKind;
    readonly text?: string;
    /** The record to keep after the change (absent for `remove`). */
    readonly record?: CursorSyncRecord;
}

export type CursorSyncConflictReason = 'bothChanged' | 'removedButEdited';

export interface CursorSyncConflict {
    readonly from: string;
    readonly target: string;
    readonly reason: CursorSyncConflictReason;
}

export interface CursorSyncPlan {
    readonly changes: readonly CursorSyncChange[];
    readonly conflicts: readonly CursorSyncConflict[];
    /** Targets that already match the Cursor file: recorded without writing. */
    readonly adopted: CursorSyncManifest;
    /** Records whose source and target are both gone. */
    readonly forgotten: readonly string[];
}

/** `cursor-sync.json` in the user config folder: records by workspace root path. */
export interface CursorSyncFile {
    readonly version: number;
    readonly workspaces: Readonly<Record<string, CursorSyncManifest>>;
}
