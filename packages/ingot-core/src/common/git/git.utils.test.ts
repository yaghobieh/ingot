import { describe, expect, it } from 'vitest';
import { isRepoRelativePath, isValidBranchName, isValidRevision, parseBranches, parseLog, parseNameStatus, relativeDate } from './git.utils';

describe('git utils', () => {
    it('parses branches with tracking info and skips remote HEAD', () => {
        const out = [
            '*\trefs/heads/main\torigin/main\t[ahead 2, behind 1]',
            ' \trefs/heads/feature/x\t\t',
            ' \trefs/remotes/origin/HEAD\t\t',
            ' \trefs/remotes/origin/main\t\t'
        ].join('\n');
        expect(parseBranches(out)).toEqual([
            { name: 'main', current: true, remote: false, upstream: 'origin/main', ahead: 2, behind: 1 },
            { name: 'feature/x', current: false, remote: false },
            { name: 'origin/main', current: false, remote: true }
        ]);
    });

    it('parses the log and name-status', () => {
        const out = `abc123\x1fabc\x1fJohn\x1f2026-10-24T10:00:00+03:00\x1fAdd math\x1fHEAD -> main, tag: v1\x1e\ndef456\x1fdef\x1fJohn\x1f2026-10-23T10:00:00+03:00\x1fInit\x1f\x1e\n`;
        expect(parseLog(out)).toEqual([
            { hash: 'abc123', short: 'abc', author: 'John', date: '2026-10-24T10:00:00+03:00', subject: 'Add math', refs: ['main', 'tag: v1'] },
            { hash: 'def456', short: 'def', author: 'John', date: '2026-10-23T10:00:00+03:00', subject: 'Init', refs: [] }
        ]);
        expect(parseNameStatus('M\tsrc/a.ts\nA\tb.ts\nR100\told.ts\tnew.ts\n')).toEqual([
            { status: 'M', path: 'src/a.ts' }, { status: 'A', path: 'b.ts' }, { status: 'R', path: 'new.ts', oldPath: 'old.ts' }
        ]);
    });

    it('validates branch names, revisions and paths', () => {
        expect(isValidBranchName('feature/IDEA-32')).toBe(true);
        for (const bad of ['-x', 'a..b', 'a b', 'a~1', 'x.lock', 'a/', 'a:b', '']) {
            expect(isValidBranchName(bad)).toBe(false);
        }
        expect(isValidRevision('abc1234~1')).toBe(true);
        expect(isValidRevision('main; rm -rf')).toBe(false);
        expect(isRepoRelativePath('src/a.ts')).toBe(true);
        expect(isRepoRelativePath('../a')).toBe(false);
        expect(isRepoRelativePath('/etc/passwd')).toBe(false);
    });

    it('formats relative dates', () => {
        const now = Date.parse('2026-10-24T12:00:00Z');
        expect(relativeDate('2026-10-24T11:59:30Z', now)).toBe('just now');
        expect(relativeDate('2026-10-24T11:00:00Z', now)).toBe('1 hour ago');
        expect(relativeDate('2026-10-21T12:00:00Z', now)).toBe('3 days ago');
    });
});

describe('IDEA-56 git helpers', () => {
    it('parses blame porcelain, including uncommitted lines', async () => {
        const { parseBlame } = await import('./git.utils');
        const sha = 'a'.repeat(40);
        const out = [
            `${sha} 1 1 1`, 'author Ada', 'author-time 1700000000', 'summary Add cart', 'filename a.ts', '\tline one',
            `${'0'.repeat(40)} 2 2 1`, 'author Not Committed Yet', 'author-time 1700000001', 'summary Version of a.ts from a.ts', 'filename a.ts', '\tline two'
        ].join('\n');
        const lines = parseBlame(out);
        expect(lines).toHaveLength(2);
        expect(lines[0]).toMatchObject({ line: 1, author: 'Ada', summary: 'Add cart' });
        expect(lines[1]).toMatchObject({ line: 2, author: 'You', summary: 'Uncommitted changes' });
    });

    it('builds remote file URLs and validates refs', async () => {
        const { isValidRef, remoteFileUrl } = await import('./git.utils');
        expect(remoteFileUrl('git@github.com:acme/shop.git', 'main', 'src/a b.ts', 4)).toBe('https://github.com/acme/shop/blob/main/src/a%20b.ts#L4');
        expect(remoteFileUrl('https://gitlab.com/acme/shop.git', 'abc', 'x.ts')).toBe('https://gitlab.com/acme/shop/-/blob/abc/x.ts');
        expect(remoteFileUrl('https://user@bitbucket.org/acme/shop', 'abc', 'x.ts', 2)).toBe('https://bitbucket.org/acme/shop/src/abc/x.ts#lines-2');
        expect(remoteFileUrl('nonsense', 'a', 'b')).toBeUndefined();
        expect(isValidRef('HEAD')).toBe(true);
        expect(isValidRef('HEAD~1')).toBe(true);
        expect(isValidRef('origin/main')).toBe(true);
        expect(isValidRef('--upload-pack=x')).toBe(false);
    });
});
