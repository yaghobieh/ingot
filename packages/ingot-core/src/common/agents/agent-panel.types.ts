import type { FileBadgeTone } from './agents.utils';

/** A context chip above the composer input, mirrored from an `@path` mention in the draft. */
export interface MentionChip {
    readonly path: string;
    readonly label: string;
    readonly badge: { readonly label: string; readonly tone: FileBadgeTone };
    readonly folder: boolean;
}

/** Where the per-turn pieces go in the thread. Indexes are message indexes; `-1` means none. */
export interface ThreadLayout {
    /** Replies that carry the "Ingot Agent" line. */
    readonly leads: ReadonlySet<number>;
    /** The latest turn's first reply: agent line with "worked for", then the Explored row. */
    readonly turnLead: number;
    /** The latest turn's last reply: the checklist. */
    readonly turnLast: number;
    /** The reply whose edits the "Edited N files" card lists. */
    readonly editsAt: number;
}

export interface DiffTotals {
    readonly added: number;
    readonly removed: number;
}
