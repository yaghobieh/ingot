import { PRODUCT } from '../product.consts';
import type { HistorySource } from './local-history.types';

export const LOCAL_HISTORY_DIR = `${PRODUCT.configFolder}/history`;
export const LOCAL_HISTORY_INDEX = 'index.json';
export const LOCAL_HISTORY_SNAPSHOT_EXT = '.snap';
/** Keeps the project's Git status clean: everything under `.ingot/history` is ignored. */
export const LOCAL_HISTORY_GITIGNORE = { name: '.gitignore', content: '*\n' } as const;
/** Oldest versions beyond this are dropped per file. */
export const MAX_HISTORY_ENTRIES = 100;
/** Files larger than this (characters) are not snapshotted. */
export const MAX_SNAPSHOT_CHARS = 2_000_000;
/** Longest readable part of a path in a history folder name; the hash keeps names unique. */
export const MAX_FOLDER_NAME_CHARS = 60;
/** 32-bit FNV-1a, for short stable folder names. */
export const FNV_OFFSET = 0x811c9dc5;
export const FNV_PRIME = 0x01000193;
export const HEX_RADIX = 16;
export const ID_RADIX = 36;

export const HISTORY_SOURCE_LABELS: Readonly<Record<HistorySource, string>> = {
    save: 'Saved',
    agent: 'Agent edit',
    'inline-edit': 'Inline edit',
    restore: 'Before restore'
};

export const HISTORY_LABELS = {
    beforeAgent: 'Before agent edit',
    beforeInlineEdit: 'Before inline edit'
} as const;

export const LOCAL_HISTORY_COMMANDS = {
    show: { id: 'ingot.localHistory.show', label: 'Show Local History', category: 'File' }
} as const;
