import { describe, expect, it } from 'vitest';
import {
    autoContextItems, clipText, diffStat, fileContext, formatAutoContext, pruneDismissed, recentEdits, recordEdit, sentAutoContext, sortDiagnostics, visibleAutoContext
} from './auto-context';
import { AUTO_CONTEXT_HEADER } from './auto-context.consts';
import type { AutoContextSnapshot, AutoDiagnostic } from './auto-context.types';

const DIFF = [
    'diff --git a/src/cart.ts b/src/cart.ts',
    '--- a/src/cart.ts',
    '+++ b/src/cart.ts',
    '@@ -1,2 +1,3 @@',
    '-export const total = 0;',
    '+export const total = 1;',
    '+export const tax = 2;',
    'diff --git a/README.md b/README.md',
    '--- a/README.md',
    '+++ b/README.md',
    '+Hello'
].join('\n');

const empty: AutoContextSnapshot = { diagnostics: [], edits: [], diff: '', memories: 0 };
const source = Array.from({ length: 100 }, (_, i) => `line ${i + 1}`).join('\n');

describe('auto-context (IDEA-267)', () => {
    it('makes no chips when the IDE has nothing to say', () => {
        expect(autoContextItems(empty)).toEqual([]);
        expect(formatAutoContext([])).toBe('');
    });

    it('sends a numbered window around the cursor of the current file', () => {
        const file = fileContext('src/cart.ts', 'file:///p/src/cart.ts', source, 60, 5);
        expect(file).toMatchObject({ cursorLine: 60, excerptStart: 55, lineCount: 100 });
        expect(file.excerpt.split('\n')).toHaveLength(11);
        expect(file.excerpt).toContain('  60| line 60');
        expect(fileContext('a.ts', 'u', 'one\ntwo', 99).cursorLine).toBe(2);
    });

    it('counts diff files and lines, and clips long diffs at a line break', () => {
        expect(diffStat(DIFF)).toEqual({ files: 2, added: 3, removed: 1 });
        expect(clipText('aaa\nbbb\nccc', 6, '…')).toBe('aaa\n…');
        expect(clipText('short', 99)).toBe('short');
    });

    it('keeps recent edits newest first, one per file, and forgets old ones', () => {
        let edits = recordEdit([], 'a.ts', [3], 1_000);
        edits = recordEdit(edits, 'b.ts', [9], 2_000);
        edits = recordEdit(edits, 'a.ts', [3, 4], 3_000);
        expect(edits).toEqual([{ path: 'a.ts', at: 3_000, lines: [3, 4] }, { path: 'b.ts', at: 2_000, lines: [9] }]);
        expect(recentEdits(edits, 3_500, 1_000).map(e => e.path)).toEqual(['a.ts']);
    });

    it('sorts errors first and the current file first', () => {
        const d = (path: string, line: number, severity: AutoDiagnostic['severity']): AutoDiagnostic => ({ path, line, severity, message: `${path}:${line}` });
        const sorted = sortDiagnostics([d('b.ts', 1, 'warning'), d('a.ts', 9, 'error'), d('cur.ts', 4, 'error')], 'cur.ts');
        expect(sorted.map(x => x.message)).toEqual(['cur.ts:4', 'a.ts:9', 'b.ts:1']);
    });

    it('turns a full snapshot into ordered, labelled chips and prompt text', () => {
        const items = autoContextItems({
            file: fileContext('src/cart.ts', 'file:///p/src/cart.ts', source, 10, 2),
            selection: { path: 'src/cart.ts', uri: 'file:///p/src/cart.ts', start: 10, end: 12, text: 'line 10\nline 11\nline 12\n' },
            diagnostics: [
                { path: 'src/cart.ts', line: 3, severity: 'error', message: "Cannot find name 'tax'.", source: 'ts' },
                { path: 'src/a.ts', line: 1, severity: 'warning', message: 'Unused' }
            ],
            edits: [{ path: 'src/cart.ts', at: 1, lines: [10] }],
            diff: DIFF,
            memories: 2
        });
        expect(items.map(i => [i.kind, i.label])).toEqual([
            ['selection', 'cart.ts (10-12)'],
            ['file', 'cart.ts'],
            ['diagnostics', '1 error, 1 warning'],
            ['edits', 'Recent edits · 1'],
            ['diff', 'Git diff +3 −1'],
            ['memory', '2 memories']
        ]);
        const text = formatAutoContext(items);
        expect(text.startsWith(AUTO_CONTEXT_HEADER)).toBe(true);
        expect(text).toContain('Selected in src/cart.ts (lines 10-12):\n```\nline 10\nline 11\nline 12\n```');
        expect(text).toContain('Current file: src/cart.ts (100 lines, cursor on line 10). Lines 8-12:');
        expect(text).toContain("- src/cart.ts:3 error: Cannot find name 'tax'. (ts)");
        expect(text).toContain('- src/cart.ts (lines 10)');
        expect(text).toContain('```diff\ndiff --git a/src/cart.ts');
        expect(sentAutoContext(items)[0]).toEqual({ kind: 'selection', label: 'cart.ts (10-12)' });
    });

    it('hides dismissed chips until their context changes', () => {
        const first = autoContextItems({ ...empty, file: fileContext('a.ts', 'u', 'x', 1) });
        const dismissed = new Set([first[0].key]);
        expect(visibleAutoContext(first, dismissed)).toEqual([]);
        const moved = autoContextItems({ ...empty, file: fileContext('b.ts', 'u', 'x', 1) });
        expect(visibleAutoContext(moved, dismissed)).toHaveLength(1);
        expect([...pruneDismissed(dismissed, moved)]).toEqual([]);
        expect(formatAutoContext(autoContextItems({ ...empty, memories: 1 }))).toBe('');
    });
});
