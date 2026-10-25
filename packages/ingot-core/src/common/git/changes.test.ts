import { describe, expect, it } from 'vitest';
import { applySelectedHunks, changeHunks, parseStatusEntries, splitPath } from './changes';
import { gitArgs, parseRecentMessages } from './git-ops';

describe('local changes', () => {
    it('parses porcelain status into colored statuses, renames included', () => {
        const out = [' M src/a.ts', 'A  src/new.ts', ' D old.ts', 'R  b2.ts', 'b.ts', 'UU conflict.ts', '?? notes.md', ''].join('\0');
        expect(parseStatusEntries(out)).toEqual([
            { path: 'b2.ts', oldPath: 'b.ts', status: 'renamed' },
            { path: 'conflict.ts', status: 'conflicted' },
            { path: 'notes.md', status: 'untracked' },
            { path: 'old.ts', status: 'deleted' },
            { path: 'src/a.ts', status: 'modified' },
            { path: 'src/new.ts', status: 'added' }
        ]);
        expect(splitPath('src/x/a.ts')).toEqual({ dir: 'src/x', name: 'a.ts' });
    });

    it('finds hunks with line numbers on both sides', () => {
        const base = 'a\nb\nc\nd\ne';
        const work = 'a\nB\nc\nd\nx\ne';
        expect(changeHunks(base, work)).toEqual([
            { index: 0, baseStart: 2, baseCount: 1, workStart: 2, workCount: 1 },
            { index: 1, baseStart: 5, baseCount: 0, workStart: 5, workCount: 1 }
        ]);
    });

    it('applies only the selected hunks for a partial commit', () => {
        const base = 'a\nb\nc\nd\ne\n';
        const work = 'a\nB\nc\nd\nx\ne\n';
        expect(applySelectedHunks(base, work, new Set([0]))).toBe('a\nB\nc\nd\ne\n');
        expect(applySelectedHunks(base, work, new Set([1]))).toBe('a\nb\nc\nd\nx\ne\n');
        expect(applySelectedHunks(base, work, new Set([0, 1]))).toBe(work);
        expect(applySelectedHunks(base, work, new Set())).toBe(base);
        expect(applySelectedHunks('a\nb\nc', 'a\nc', new Set([0]))).toBe('a\nc');
    });
});

describe('commit / push git args', () => {
    it('builds commit and push arguments with validation', () => {
        expect(gitArgs({ kind: 'commit', message: 'm', paths: ['a.ts'], amend: true, signoff: true, noVerify: false }))
            .toEqual(['commit', '-F', '-', '--amend', '--signoff', '--only', '--', 'a.ts']);
        expect(gitArgs({ kind: 'commit', message: 'm', amend: false, signoff: false, noVerify: true })).toEqual(['commit', '-F', '-', '--no-verify']);
        expect(gitArgs({ kind: 'pushTo', remote: 'origin', localBranch: 'main', remoteBranch: 'feat/x', tags: 'current', force: true, setUpstream: true }))
            .toEqual(['push', '--porcelain', '--force-with-lease', '--follow-tags', '--set-upstream', 'origin', 'main:refs/heads/feat/x']);
        expect(() => gitArgs({ kind: 'pushTo', remote: '--exec=x', localBranch: 'main', remoteBranch: 'main', tags: 'none', force: false, setUpstream: false })).toThrow();
        expect(() => gitArgs({ kind: 'commit', message: 'm', paths: ['../etc/passwd'], amend: false, signoff: false, noVerify: false })).toThrow();
        expect(parseRecentMessages('fix a\n\x1efix a\x1e\nadd b\n\x1e')).toEqual(['fix a', 'add b']);
    });
});
