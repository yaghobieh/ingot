import { FNV_OFFSET, FNV_PRIME, HEX_RADIX, HISTORY_SOURCE_LABELS, ID_RADIX, LOCAL_HISTORY_DIR, LOCAL_HISTORY_SNAPSHOT_EXT, MAX_FOLDER_NAME_CHARS } from './local-history.consts';
import type { AppendResult, HistoryEntry, HistoryIndex, HistorySource } from './local-history.types';

const SOURCES = Object.keys(HISTORY_SOURCE_LABELS) as HistorySource[];

const hash = (text: string): string => {
    let h = FNV_OFFSET;
    for (let i = 0; i < text.length; i++) {
        h ^= text.charCodeAt(i);
        h = Math.imul(h, FNV_PRIME);
    }
    return (h >>> 0).toString(HEX_RADIX);
};

/** A readable, unique folder name for one file's history (`src/app.ts` → `src_app.ts-1a2b3c4d`). */
export const historyFolderName = (relativePath: string): string => {
    const readable = relativePath.replace(/[^A-Za-z0-9._-]+/g, '_').slice(-MAX_FOLDER_NAME_CHARS);
    return `${readable}-${hash(relativePath)}`;
};

export const snapshotFileName = (entry: HistoryEntry): string => `${entry.id}${LOCAL_HISTORY_SNAPSHOT_EXT}`;

/** Files inside the history folder itself are never snapshotted. */
export const isHistoryPath = (relativePath: string): boolean =>
    relativePath === LOCAL_HISTORY_DIR || relativePath.startsWith(`${LOCAL_HISTORY_DIR}/`);

export const createEntry = (
    data: { timestamp: number; source: HistorySource; label?: string; size: number },
    existing: readonly HistoryEntry[]
): HistoryEntry => {
    const base = `${data.timestamp.toString(ID_RADIX)}-${data.source}`;
    let id = base;
    for (let n = 1; existing.some(e => e.id === id); n++) {
        id = `${base}-${n}`;
    }
    return { id, timestamp: data.timestamp, source: data.source, label: data.label || HISTORY_SOURCE_LABELS[data.source], size: data.size };
};

/** Adds the newest entry first and drops the oldest ones beyond `max`. */
export const appendEntry = (index: HistoryIndex, entry: HistoryEntry, max: number): AppendResult => {
    const entries = [entry, ...index.entries];
    return { index: { path: index.path, entries: entries.slice(0, max) }, dropped: entries.slice(max) };
};

const isEntry = (value: unknown): value is HistoryEntry => {
    const e = value as Partial<HistoryEntry> | undefined;
    return !!e && typeof e.id === 'string' && typeof e.timestamp === 'number' && typeof e.label === 'string'
        && typeof e.size === 'number' && SOURCES.includes(e.source as HistorySource);
};

/** Reads an index file; anything unreadable starts a fresh history. */
export const parseIndex = (text: string | undefined, path: string): HistoryIndex => {
    try {
        const raw = JSON.parse(text ?? '') as { entries?: unknown };
        const entries = Array.isArray(raw.entries) ? raw.entries.filter(isEntry) : [];
        return { path, entries: [...entries].sort((a, b) => b.timestamp - a.timestamp) };
    } catch {
        return { path, entries: [] };
    }
};

const pad = (n: number): string => String(n).padStart(2, '0');

/** `14:05:09` today, else `2026-10-29 14:05`. */
export const formatEntryTime = (timestamp: number, now: number): string => {
    const at = new Date(timestamp);
    const today = new Date(now);
    const time = `${pad(at.getHours())}:${pad(at.getMinutes())}`;
    if (at.toDateString() === today.toDateString()) {
        return `${time}:${pad(at.getSeconds())}`;
    }
    return `${at.getFullYear()}-${pad(at.getMonth() + 1)}-${pad(at.getDate())} ${time}`;
};
