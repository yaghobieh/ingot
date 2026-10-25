import { describe, expect, it } from 'vitest';
import { buildMerged, extractMergedFile, merge3, nonConflictingChoice } from './merge3';
import { gitArgs } from './git-ops';

const base = 'a\nb\nc\nd\ne\n';

describe('merge3 (IDEA-33)', () => {
    it('separates non-conflicting changes from conflicts', () => {
        const ours = 'a\nB-ours\nc\nD-ours\ne\n';
        const theirs = 'a\nB-theirs\nc\nd\ne\nf\n';
        const chunks = merge3(base, ours, theirs);
        expect(chunks.map(c => c.kind)).toEqual(['conflict', 'ours', 'theirs']);
        expect(chunks[0].ours).toEqual(['B-ours']);
        expect(chunks[0].theirs).toEqual(['B-theirs']);
        expect(buildMerged(base, chunks, nonConflictingChoice)).toBe('a\nb\nc\nD-ours\ne\nf\n');
        expect(buildMerged(base, chunks, c => c.kind === 'conflict' ? 'both' : nonConflictingChoice(c))).toBe('a\nB-ours\nB-theirs\nc\nD-ours\ne\nf\n');
        expect(buildMerged(base, chunks, () => 'base')).toBe(base);
    });
    it('treats identical changes as one', () => {
        const chunks = merge3(base, 'a\nX\nc\nd\ne\n', 'a\nX\nc\nd\ne\n');
        expect(chunks.map(c => c.kind)).toEqual(['same']);
    });
    it('reports a conflict for edits to the same line and an empty merge for no changes', () => {
        expect(merge3(base, base, base)).toEqual([]);
        expect(merge3(base, 'a\nb\nc\nd\nE1\n', 'a\nb\nc\nd\nE2\n').map(c => c.kind)).toEqual(['conflict']);
    });
    it('extracts the merged file from a reply', () => {
        expect(extractMergedFile('Here:\n```ts\nconst a = 1;\n```\nthanks')).toBe('const a = 1;\n');
        expect(extractMergedFile('plain')).toBe('plain\n');
    });
    it('builds validated git arguments for conflicts', () => {
        expect(gitArgs({ kind: 'showStage', stage: 2, path: 'src/a.ts' })).toEqual(['show', ':2:src/a.ts']);
        expect(gitArgs({ kind: 'checkoutSide', side: 'theirs', paths: ['a.ts'] })).toEqual(['checkout', '--theirs', '--', 'a.ts']);
        expect(() => gitArgs({ kind: 'showStage', stage: 2, path: '../x' })).toThrow();
    });
});
