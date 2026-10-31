import type { MemoryScope } from '../memories/memories.types';

/** IDEA-287: one Cursor memory found on disk, and where it goes in Ingot memory. */
export interface CursorMemory {
    readonly text: string;
    readonly scope: MemoryScope;
    /** The file it came from, relative to the workspace or `~/.cursor`. */
    readonly from: string;
}

/** A place Cursor memories can live: a folder of Markdown files or a JSON export. */
export interface CursorMemorySource {
    readonly path: string;
    readonly kind: 'dir' | 'json';
}
