/** IDEA-287: Convert mode keeps `.ingot` in sync with later `.cursor` changes; what each workspace's last sync wrote. */
export const CURSOR_SYNC_FILE = 'cursor-sync.json';
export const CURSOR_SYNC_FILE_VERSION = 1;
/** Wait for a burst of file events (a git checkout, an editor save) before checking. */
export const CURSOR_SYNC_DEBOUNCE_MS = 1500;

/** Kinds merged into an existing `.ingot` file instead of copied (they only gain new entries). */
export const CURSOR_MERGE_KINDS: readonly string[] = ['mcp', 'hooks', 'ignore'];

/** Workspace-relative files whose change can need a sync (nested AGENTS.md and `.cursor` folders too). */
export const CURSOR_ROOT_SYNC_FILES: readonly string[] = ['.cursorrules', '.cursorignore', '.cursorindexingignore'];
export const CURSOR_SYNC_DIR = '.cursor';
export const AGENTS_FILE = 'AGENTS.md';

export const CURSOR_SYNC_COMMAND = { id: 'ingot.import.cursorPull', label: 'Cursor Config: Pull Changes into .ingot', category: 'Ingot' } as const;

export const CURSOR_SYNC_PROMPT = {
    changed: 'Cursor config changed in this workspace',
    pull: 'Pull changes',
    later: 'Not now',
    inSync: '.ingot is in sync with this workspace\'s Cursor config.',
    notConverted: 'This workspace does not use Convert mode. "Cursor Config: Change Import Mode…" turns it on.'
} as const;

export const CURSOR_SYNC_CONFLICT_TEXT = {
    bothChanged: 'changed in .cursor and edited in .ingot (kept the .ingot version)',
    removedButEdited: 'removed from .cursor but edited in .ingot (kept)'
} as const;

/** FNV-1a (32 bit): a fast fingerprint for change detection, not for security. */
export const FNV_OFFSET = 0x811c9dc5;
export const FNV_PRIME = 0x01000193;
export const HASH_RADIX = 16;
