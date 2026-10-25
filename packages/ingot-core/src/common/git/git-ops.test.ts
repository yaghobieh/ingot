import { describe, expect, it } from 'vitest';
import { DESTRUCTIVE_OPS, gitArgs, parseRemotes, parseStashList, parseStatusPaths, rewordTodo } from './git-ops';

describe('gitArgs', () => {
    it('builds validated argument lists', () => {
        expect(gitArgs({ kind: 'add', paths: ['src/a.ts'] })).toEqual(['add', '--', 'src/a.ts']);
        expect(gitArgs({ kind: 'revert', commit: 'abc1234' })).toEqual(['revert', '--no-edit', 'abc1234']);
        expect(gitArgs({ kind: 'cherryPick', commit: 'abc1234' })).toEqual(['cherry-pick', 'abc1234']);
        expect(gitArgs({ kind: 'stash', message: 'wip', paths: ['a.ts'] })).toEqual(['stash', 'push', '-m', 'wip', '--', 'a.ts']);
        expect(gitArgs({ kind: 'stashApply', index: 2, pop: true })).toEqual(['stash', 'pop', 'stash@{2}']);
        expect(gitArgs({ kind: 'reset', ref: 'HEAD~1', mode: 'hard' })).toEqual(['reset', '--hard', 'HEAD~1']);
        expect(gitArgs({ kind: 'push', setUpstream: true })).toEqual(['push', '--set-upstream', 'origin', 'HEAD']);
        expect(gitArgs({ kind: 'logLines', path: 'a.ts', start: 3, end: 7 })).toContain('-L3,7:a.ts');
        expect(gitArgs({ kind: 'blameAt', path: 'src/a.ts', rev: 'abc123~1' })).toEqual(['blame', '--line-porcelain', 'abc123~1', '--', 'src/a.ts']);
        expect(gitArgs({ kind: 'commitInfo', commit: 'abc123' })).toContain('abc123');
        expect(() => gitArgs({ kind: 'blameAt', path: 'a.ts', rev: '--output=x' })).toThrow();
        expect(gitArgs({ kind: 'createTag', name: 'v1.0', commit: 'abc1234', message: 'Release' })).toEqual(['tag', '-a', 'v1.0', '-m', 'Release', 'abc1234']);
        expect(gitArgs({ kind: 'dropCommit', commit: 'abc1234' })).toEqual(['rebase', '--onto', 'abc1234~1', 'abc1234']);
        expect(gitArgs({ kind: 'fixup', commit: 'abc1234', squash: false })).toEqual(['commit', '--fixup=abc1234', '--no-edit']);
        expect(gitArgs({ kind: 'logOnly', branch: 'feature/x' }).slice(-4)).toEqual(['feature/x', '--not', 'HEAD', '--']);
    });

    it('rejects anything that could be an option or escape the repo', () => {
        expect(() => gitArgs({ kind: 'add', paths: ['../etc/passwd'] })).toThrow('Invalid path');
        expect(() => gitArgs({ kind: 'add', paths: ['--all'] })).toThrow('Invalid path');
        expect(() => gitArgs({ kind: 'revert', commit: '--abort' })).toThrow('Invalid commit');
        expect(() => gitArgs({ kind: 'merge', branch: '-X theirs' })).toThrow('Invalid branch');
        expect(() => gitArgs({ kind: 'addRemote', name: 'up', url: '--upload-pack=evil' })).toThrow('Invalid remote URL');
        expect(() => gitArgs({ kind: 'stashDrop', index: -1 })).toThrow('Invalid stash');
        expect(() => gitArgs({ kind: 'logLines', path: 'a.ts', start: 0, end: 1 })).toThrow('Invalid line');
    });

    it('marks history-rewriting and discarding operations as destructive', () => {
        for (const kind of ['reset', 'dropCommit', 'deleteBranch', 'restorePaths', 'checkoutRevision'] as const) {
            expect(DESTRUCTIVE_OPS).toContain(kind);
        }
        expect(DESTRUCTIVE_OPS).not.toContain('fetch');
    });
});

describe('parsers', () => {
    it('parses stash list, remotes and status', () => {
        expect(parseStashList('stash@{0}\x1fOn main: wip\x1f2026-10-24T10:00:00+03:00\n')).toEqual([{ index: 0, message: 'On main: wip', date: '2026-10-24T10:00:00+03:00' }]);
        expect(parseRemotes('origin\tgit@github.com:a/b.git (fetch)\norigin\tgit@github.com:a/b.git (push)\nup\thttps://x/y (fetch)\n'))
            .toEqual([{ name: 'origin', url: 'git@github.com:a/b.git' }, { name: 'up', url: 'https://x/y' }]);
        expect(parseStatusPaths(' M src/a.ts\0?? new.ts\0R  b.ts\0old-b.ts\0')).toEqual(['src/a.ts', 'b.ts']);
        expect(parseStatusPaths('?? new.ts\0', true)).toEqual(['new.ts']);
    });

    it('rewrites the rebase todo for reword', () => {
        expect(rewordTodo('pick abc1234 First\npick def5678 Second\n', 'def5678')).toBe('pick abc1234 First\nreword def5678 Second\n');
    });
});
