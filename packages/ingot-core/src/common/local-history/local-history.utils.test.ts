import { describe, expect, it } from 'vitest';
import { appendEntry, createEntry, formatEntryTime, historyFolderName, isHistoryPath, parseIndex, snapshotFileName } from './local-history.utils';
import type { HistoryEntry } from './local-history.types';

const entry = (id: string, timestamp: number): HistoryEntry => ({ id, timestamp, source: 'save', label: 'Saved', size: 1 });

describe('local history', () => {
    it('names history folders readably and uniquely per path', () => {
        expect(historyFolderName('src/app.ts')).toMatch(/^src_app\.ts-[0-9a-f]+$/);
        expect(historyFolderName('src/app.ts')).toBe(historyFolderName('src/app.ts'));
        expect(historyFolderName('src/app.ts')).not.toBe(historyFolderName('src_app.ts'));
        expect(historyFolderName(`${'deep/'.repeat(40)}file.ts`).length).toBeLessThan(80);
    });

    it('never snapshots its own folder', () => {
        expect(isHistoryPath('.ingot/history')).toBe(true);
        expect(isHistoryPath('.ingot/history/src_app.ts-1/index.json')).toBe(true);
        expect(isHistoryPath('.ingot/rules/a.md')).toBe(false);
        expect(isHistoryPath('src/.ingot/historyish.ts')).toBe(false);
    });

    it('creates unique ids and default labels', () => {
        const first = createEntry({ timestamp: 1000, source: 'agent', size: 3 }, []);
        expect(first.label).toBe('Agent edit');
        const second = createEntry({ timestamp: 1000, source: 'agent', label: 'Before agent edit', size: 3 }, [first]);
        expect(second.id).not.toBe(first.id);
        expect(second.label).toBe('Before agent edit');
        expect(snapshotFileName(first)).toBe(`${first.id}.snap`);
    });

    it('keeps newest first and drops entries past the cap', () => {
        let index = { path: 'a.ts', entries: [] as HistoryEntry[] };
        const dropped: HistoryEntry[] = [];
        for (let i = 1; i <= 4; i++) {
            const result = appendEntry(index, entry(`e${i}`, i), 3);
            index = { ...result.index, entries: [...result.index.entries] };
            dropped.push(...result.dropped);
        }
        expect(index.entries.map(e => e.id)).toEqual(['e4', 'e3', 'e2']);
        expect(dropped.map(e => e.id)).toEqual(['e1']);
    });

    it('parses an index and survives bad files', () => {
        const text = JSON.stringify({ entries: [entry('old', 1), { id: 'broken' }, entry('new', 2)] });
        expect(parseIndex(text, 'a.ts').entries.map(e => e.id)).toEqual(['new', 'old']);
        expect(parseIndex('not json', 'a.ts')).toEqual({ path: 'a.ts', entries: [] });
        expect(parseIndex(undefined, 'a.ts').entries).toEqual([]);
    });

    it('formats times for today and earlier days', () => {
        const now = new Date(2026, 9, 30, 15, 0, 0).getTime();
        expect(formatEntryTime(new Date(2026, 9, 30, 9, 5, 7).getTime(), now)).toBe('09:05:07');
        expect(formatEntryTime(new Date(2026, 9, 29, 23, 59, 0).getTime(), now)).toBe('2026-10-29 23:59');
    });
});
