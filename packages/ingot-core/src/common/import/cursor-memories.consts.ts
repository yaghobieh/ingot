import type { CursorMemorySource } from './cursor-memories.types';

/**
 * IDEA-287: Cursor Memories were kept on Cursor's servers and are no longer documented, so only local copies can be
 * imported: a `memories` folder (one Markdown file per memory) or a `memories.json` export, in the project's `.cursor`
 * (repo facts) or in `~/.cursor` (personal preferences).
 */
export const CURSOR_MEMORY_SOURCES: readonly CursorMemorySource[] = [
    { path: 'memories', kind: 'dir' },
    { path: 'memories.json', kind: 'json' }
];
export const CURSOR_MEMORY_EXTENSIONS: readonly string[] = ['.md', '.mdc', '.txt'];
/** Object fields an exported memory's text can be under, in order of preference. */
export const CURSOR_MEMORY_TEXT_FIELDS: readonly string[] = ['memory', 'content', 'text', 'body', 'title'];
export const CURSOR_MEMORIES_KEY = 'memories';
/** The last set of memories offered, per workspace, so the offer is not repeated. */
export const CURSOR_MEMORIES_OFFERED_KEY = 'ingot.import.cursorMemories.offered';

export const CURSOR_MEMORIES_COMMAND = { id: 'ingot.import.cursorMemories', label: 'Cursor Config: Import Memories', category: 'Ingot' } as const;

export const CURSOR_MEMORIES_PROMPT = {
    import: 'Import memories',
    later: 'Not now',
    none: 'No Cursor memories to import (looked in .cursor/memories, .cursor/memories.json and the same in ~/.cursor).'
} as const;
