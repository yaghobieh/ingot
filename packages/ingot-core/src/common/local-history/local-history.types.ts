/** Local History (IDEA-262): file versions kept under `.ingot/history` on every save and agent edit. */
export type HistorySource = 'save' | 'agent' | 'inline-edit' | 'restore';

export interface HistoryEntry {
    readonly id: string;
    readonly timestamp: number;
    readonly source: HistorySource;
    readonly label: string;
    /** Characters in the snapshot. */
    readonly size: number;
}

/** One file's history; entries are newest first. */
export interface HistoryIndex {
    /** Project-relative path of the file. */
    readonly path: string;
    readonly entries: readonly HistoryEntry[];
}

export interface AppendResult {
    readonly index: HistoryIndex;
    /** Entries pushed out by the size cap; their snapshots can be deleted. */
    readonly dropped: readonly HistoryEntry[];
}
