import { describe, expect, it } from 'vitest';
import { docComment, filterOutline, formatSize, gitStatusLabel, parseLastCommit, pathTo, symbolSignature, visibleRows, type OutlineItem } from './breadcrumbs.utils';

const tree: OutlineItem[] = [
    { id: 'a', name: 'SettingsPages', children: [
        { id: 'a1', name: 'useEffect() callback', children: [{ id: 'a1x', name: 'then() callback', children: [] }] },
        { id: 'a2', name: 'isAdmin', children: [] }
    ] },
    { id: 'b', name: 'helper', children: [] }
];

describe('breadcrumbs utils', () => {
    it('formats sizes and git status', () => {
        expect(formatSize(512)).toBe('512 B');
        expect(formatSize(2048)).toBe('2.0 KB');
        expect(gitStatusLabel('')).toBe('Unchanged');
        expect(gitStatusLabel(' M src/a.ts\0')).toBe('Modified');
        expect(gitStatusLabel('?? new.ts\0')).toBe('Unversioned');
        expect(gitStatusLabel('UU c.ts\0')).toBe('Conflicted');
    });
    it('parses the last commit', () => {
        expect(parseLastCommit('abc\x1fJohn\x1f2026-10-24T10:00:00+03:00\x1fFix it\n')).toEqual({ hash: 'abc', author: 'John', date: '2026-10-24T10:00:00+03:00', subject: 'Fix it' });
        expect(parseLastCommit('')).toBeUndefined();
    });
    it('reads signature and doc comment', () => {
        const lines = ['/**', ' * Adds two numbers.', ' * @param a first', ' */', 'export function add(a: number, b: number): number {', '// sums', 'const x = 1;'];
        expect(symbolSignature(lines, 4)).toBe('export function add(a: number, b: number): number');
        expect(docComment(lines, 4)).toBe('Adds two numbers.\n@param a first');
        expect(docComment(lines, 6)).toBe('sums');
        expect(docComment(lines, 0)).toBe('');
    });
    it('expands the path, filters and lists rows', () => {
        expect(pathTo(tree, 'a1x')).toEqual(['a', 'a1', 'a1x']);
        const rows = visibleRows(tree, new Set(['a']));
        expect(rows.map(r => `${r.depth}:${r.item.name}`)).toEqual(['0:SettingsPages', '1:useEffect() callback', '1:isAdmin', '0:helper']);
        const filter = filterOutline(tree, 'then');
        expect([...filter!]).toEqual(['a', 'a1', 'a1x']);
        expect(visibleRows(tree, new Set(), filter).map(r => r.item.id)).toEqual(['a', 'a1', 'a1x']);
        expect(filterOutline(tree, ' ')).toBeUndefined();
    });
});
