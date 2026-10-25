import { describe, expect, it } from 'vitest';
import { actionLine, activityLine, describeAction, gitOperationFor, needsApproval, skippedResult, toAlwaysRunMap, updateAlwaysRun } from './agent-actions';

const git = (args: Record<string, unknown>) => ({ server: 'ingot', tool: 'git', args });

describe('IDEA-109 agent actions', () => {
    it('describes git writes for the card and lets reads through', () => {
        expect(describeAction(git({ op: 'commit', message: 'Fix the parser\n\nlong body' }))).toEqual({ kind: 'git', label: 'Git commit', detail: 'Fix the parser' });
        expect(describeAction(git({ op: 'push' }), 'feature/x')?.detail).toBe('feature/x → origin');
        expect(describeAction(git({ op: 'push', branch: 'main', remote: 'up' }))?.detail).toBe('main → up');
        expect(describeAction(git({ op: 'status' }))).toBeUndefined();
        expect(describeAction({ server: 'ingot', tool: 'web_search', args: { query: 'Mantine components list' } })).toEqual({ kind: 'web', label: 'Search web', detail: 'Mantine components list' });
        expect(describeAction({ server: 'files', tool: 'read', args: { path: 'a.ts' } })).toEqual({ kind: 'mcp', label: 'files: read', detail: 'a.ts' });
    });

    it('maps git calls to operations', () => {
        expect(gitOperationFor({ op: 'commit', message: 'm' })).toMatchObject({ kind: 'commit', message: 'm', amend: false });
        expect(gitOperationFor({ op: 'push', branch: 'b' })).toMatchObject({ kind: 'pushTo', remote: 'origin', localBranch: 'b', force: false });
        expect(gitOperationFor({ op: 'reset', ref: 'HEAD~1', mode: 'hard' })).toEqual({ kind: 'reset', ref: 'HEAD~1', mode: 'hard' });
        expect(() => gitOperationFor({ op: 'gc' })).toThrow(/Unknown git op/);
    });

    it('Always Run is per project and per kind, and revocable', () => {
        const map = updateAlwaysRun(undefined, '/p', 'git');
        const commit = { kind: 'git' as const, label: 'Git commit', detail: 'x' };
        expect(needsApproval(commit, '/p', map, true)).toBe(false);
        expect(needsApproval(commit, '/other', map, true)).toBe(true);
        expect(needsApproval({ ...commit, kind: 'terminal' }, '/p', map, true)).toBe(true);
        expect(needsApproval(commit, '/other', {}, false)).toBe(false);
        expect(updateAlwaysRun(map, '/p', 'git', true)).toEqual({});
        expect(toAlwaysRunMap({ '/p': ['git', 'bogus'], '/q': 'x' })).toEqual({ '/p': ['git'] });
    });

    it('formats the card, the activity line and the skip result', () => {
        expect(actionLine({ kind: 'web', label: 'Search web', detail: 'Mantine components list 8 notable ones with docs' }, 40)).toBe('Search web: Mantine components list 8 n…');
        expect(activityLine([{ kind: 'read', target: 'a.ts, b.ts' }, { kind: 'read', target: 'rules: x' }, { kind: 'run', target: 'ingot/web_search' }, { kind: 'search', target: 'q' }])).toBe('Exploring 2 files, 2 searches');
        expect(activityLine([])).toBeUndefined();
        expect(skippedResult({ kind: 'git', label: 'Git push', detail: 'main → origin' }, 'not yet')).toContain('Reason: not yet');
    });
});
