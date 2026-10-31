import { describe, expect, it } from 'vitest';
import { TAB_CURSOR, TAB_NEXT_MARKER, TAB_RECENT_EDIT_MAX_CHARS } from './tab.consts';
import { buildTabMessages, findNextEditLine, isSubsequence, parseTabReply, recordRecentEdit, trimPrefixOverlap } from './tab.utils';

describe('Tab prompt (IDEA-285)', () => {
    it('sends prefix and suffix around a cursor marker plus the recent edits', () => {
        const [system, user] = buildTabMessages({
            language: 'typescript', path: 'src/math.ts', prefix: 'export function sub', suffix: '\n}',
            recentEdits: [{ line: 3, text: 'const total = 0;' }]
        });
        expect(system.role).toBe('system');
        expect(system.content).toContain('Ingot Tab');
        expect(system.content).toContain(TAB_NEXT_MARKER);
        expect(user.content).toContain('File: src/math.ts');
        expect(user.content).toContain('- line 3: const total = 0;');
        expect(user.content.endsWith(`export function sub${TAB_CURSOR}\n}`)).toBe(true);
    });

    it('leaves out the recent edits block when there are none', () => {
        const [, user] = buildTabMessages({ language: 'ts', path: 'a.ts', prefix: 'a', suffix: 'b', recentEdits: [] });
        expect(user.content).not.toContain('Recent edits');
    });
});

describe('parseTabReply', () => {
    it('returns plain ghost text', () => {
        expect(parseTabReply('tract(a: number, b: number) {', 'export function sub', '')).toEqual({ insertText: 'tract(a: number, b: number) {', replacesSuffix: false });
    });

    it('strips fences, cursor markers and a repeated line, with or without its indentation', () => {
        expect(parseTabReply('```ts\nconst x = 1;<CURSOR>\n```', 'const x', '').insertText).toBe(' = 1;');
        expect(parseTabReply('return a - b;', '    return ', '').insertText).toBe('a - b;');
    });

    it('drops an opening bracket or identifier the line already ends with', () => {
        expect(parseTabReply('(a: number): number {', 'function sub(', ')').insertText).toBe('a: number): number {');
        expect(parseTabReply('subtract(a, b)', 'export function sub', '').insertText).toBe('tract(a, b)');
    });

    it('replaces the rest of the line, keeping an auto-closed bracket the reply already has', () => {
        expect(parseTabReply('a, b);', 'sum(', ');')).toEqual({ insertText: 'a, b);', replacesSuffix: true });
        expect(parseTabReply('a, b', 'sum(', ')')).toEqual({ insertText: 'a, b)', replacesSuffix: true });
    });

    it('splits off the next-edit line', () => {
        const reply = `tract(a, b) {\n${TAB_NEXT_MARKER} export const total = add(1, 2);`;
        expect(parseTabReply(reply, 'function sub', '')).toEqual({ insertText: 'tract(a, b) {', replacesSuffix: false, nextSnippet: 'export const total = add(1, 2);' });
    });

    it('allows a next edit without ghost text', () => {
        expect(parseTabReply(`${TAB_NEXT_MARKER} return a + b;`, '', ')')).toEqual({ insertText: '', replacesSuffix: false, nextSnippet: 'return a + b;' });
    });

    it('ignores a too-short or empty next-edit line and whitespace-only text', () => {
        expect(parseTabReply(`  \n${TAB_NEXT_MARKER} }`, '', '')).toEqual({ insertText: '', replacesSuffix: false });
    });
});

describe('trimPrefixOverlap and isSubsequence', () => {
    it('only trims whole identifiers and opening brackets', () => {
        expect(trimPrefixOverlap('total2', 'const subtotal')).toBe('total2');
        expect(trimPrefixOverlap('1 + 2', 'x = 1 + ')).toBe('1 + 2');
        expect(trimPrefixOverlap('["a"]', 'const list = [')).toBe('"a"]');
        expect(trimPrefixOverlap('ab', 'ab')).toBe('ab');
    });

    it('matches characters in order', () => {
        expect(isSubsequence(');', 'a, b);')).toBe(true);
        expect(isSubsequence(')]', 'a])')).toBe(false);
        expect(isSubsequence('', 'x')).toBe(true);
    });
});

describe('findNextEditLine', () => {
    const lines = ['const a = add(1);', 'function add(x) {', '  return x;', '}', 'const b = add(2);'];

    it('prefers the first match below the cursor', () => {
        expect(findNextEditLine(lines, 'add(', 2)).toBe(5);
    });

    it('falls back to the closest match above and skips the cursor line', () => {
        expect(findNextEditLine(lines, 'add(1)', 5)).toBe(1);
        expect(findNextEditLine(lines, 'function add', 2)).toBeUndefined();
    });

    it('needs a meaningful snippet', () => {
        expect(findNextEditLine(lines, ' } ', 1)).toBeUndefined();
        expect(findNextEditLine(lines, 'missing()', 1)).toBeUndefined();
    });
});

describe('recordRecentEdit', () => {
    it('keeps one entry per line, newest last, capped', () => {
        let edits = recordRecentEdit([], { line: 1, text: 'a' }, 2);
        edits = recordRecentEdit(edits, { line: 2, text: 'b' }, 2);
        edits = recordRecentEdit(edits, { line: 1, text: '  a2  ' }, 2);
        expect(edits).toEqual([{ line: 2, text: 'b' }, { line: 1, text: 'a2' }]);
        expect(recordRecentEdit(edits, { line: 3, text: 'c' }, 2)).toEqual([{ line: 1, text: 'a2' }, { line: 3, text: 'c' }]);
    });

    it('forgets a line that became empty and clips long lines', () => {
        expect(recordRecentEdit([{ line: 4, text: 'x' }], { line: 4, text: '   ' }, 5)).toEqual([]);
        expect(recordRecentEdit([], { line: 1, text: 'y'.repeat(TAB_RECENT_EDIT_MAX_CHARS * 2) }, 5)[0].text).toHaveLength(TAB_RECENT_EDIT_MAX_CHARS);
    });
});
