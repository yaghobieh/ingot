import { describe, expect, it } from 'vitest';
import type { CodeChange } from './changes.types';
import { buildHunks, changeStats, composeText, decide, hunkLines, isPending, miniDiff, rebaseChange, restorePlan, reviewAnchors, reviewBase, statusOf, streamingPreview } from './changes.utils';

const OLD = ['a', 'b', 'c', 'd', 'e', 'f', 'g'].join('\n');
const NEW = ['a', 'B', 'c', 'd', 'e', 'f2', 'f3', 'g'].join('\n');

const change = (): CodeChange => ({ id: 'c1', sessionId: 's', messageIndex: 1, path: 'x.ts', uri: 'file:///x.ts', oldText: OLD, newText: NEW, created: false, hunks: buildHunks(OLD, NEW), status: 'applied' });

describe('IDEA-102 code changes', () => {
    it('splits an edit into hunks with old/new positions and +/- counts', () => {
        const hunks = buildHunks(OLD, NEW);
        expect(hunks.map(h => [h.oldStart, h.newStart, h.removed, h.added])).toEqual([[1, 1, ['b'], ['B']], [5, 5, ['f'], ['f2', 'f3']]]);
        expect(changeStats(hunks)).toEqual({ added: 3, removed: 2 });
    });

    it('composes the text from per-hunk decisions', () => {
        const c = change();
        expect(composeText(OLD, c.hunks)).toBe(NEW);
        const first = decide(c, ['h0'], 'rejected');
        expect(composeText(OLD, first.hunks)).toBe(['a', 'b', 'c', 'd', 'e', 'f2', 'f3', 'g'].join('\n'));
        expect(first.status).toBe('applied');
        expect(isPending(first)).toBe(true);
        const both = decide(first, ['h1'], 'accepted');
        expect(both.status).toBe('partial');
        expect(isPending(both)).toBe(false);
        expect(decide(c, 'all', 'rejected').status).toBe('rejected');
        expect(composeText(OLD, decide(c, 'all', 'rejected').hunks)).toBe(OLD);
        expect(decide(c, 'all', 'accepted').status).toBe('accepted');
        expect(statusOf([])).toBe('accepted');
    });

    it('keeps decided hunks fixed when deciding the rest', () => {
        const c = decide(change(), ['h0'], 'accepted');
        expect(decide(c, 'all', 'rejected').hunks.map(h => h.state)).toEqual(['accepted', 'rejected']);
    });

    it('locates hunks in the current text after earlier hunks change the line count', () => {
        const c = change();
        expect([...hunkLines(c.hunks).entries()]).toEqual([['h0', { start: 1, length: 1 }], ['h1', { start: 5, length: 2 }]]);
        const longer = buildHunks('a\nb', 'x\ny\nz\na\nb\nc');
        expect([...hunkLines(longer).values()]).toEqual([{ start: 0, length: 3 }, { start: 5, length: 1 }]);
    });

    it('IDEA-268: compares the review against the old text with only accepted hunks applied', () => {
        const c = decide(change(), ['h1'], 'accepted');
        expect(reviewBase(c)).toBe(['a', 'b', 'c', 'd', 'e', 'f2', 'f3', 'g'].join('\n'));
        expect(reviewBase(decide(change(), ['h0'], 'rejected'))).toBe(OLD);
    });

    it('IDEA-268: rebases pending hunks on a user edit and keeps decided ones in the base', () => {
        const accepted = decide(change(), ['h0'], 'accepted');
        const edited = ['a', 'B', 'c', 'd', 'e', 'f2', 'mine', 'g'].join('\n');
        const next = rebaseChange(accepted, edited, 'r');
        expect(next.oldText).toBe(['a', 'B', 'c', 'd', 'e', 'f', 'g'].join('\n'));
        expect(next.hunks.map(h => [h.id, h.removed, h.added, h.state])).toEqual([['r0', ['f'], ['f2', 'mine'], 'pending']]);
        expect(composeText(next.oldText, next.hunks)).toBe(edited);
        expect(next.status).toBe('applied');
        const undone = rebaseChange(accepted, next.oldText, 'r');
        expect(undone.hunks).toEqual([]);
        expect(undone.status).toBe('accepted');
    });

    it('IDEA-268: anchors each pending hunk on its first line in the current text', () => {
        const c = decide(change(), ['h0'], 'rejected');
        expect(reviewAnchors(c.hunks, 8)).toEqual([{ hunkId: 'h1', line: 6, added: 2, removed: 1 }]);
        const deletedTail = buildHunks('a\nb\nc', 'a');
        expect(reviewAnchors(deletedTail, 1)).toEqual([{ hunkId: 'h0', line: 1, added: 0, removed: 2 }]);
    });

    it('previews a streaming edit over the old file', () => {
        expect(streamingPreview('1\n2\n3\n4', 'one\ntwo')).toBe('one\ntwo\n3\n4');
    });

    it('builds a mini diff with context and gaps', () => {
        const { rows, truncated } = miniDiff(change(), 1, 100);
        expect(rows.map(r => `${r.kind[0]}${r.text}`)).toEqual(['ca', 'rb', 'aB', 'cc', 'g…', 'ce', 'rf', 'af2', 'af3', 'cg']);
        expect(truncated).toBe(false);
        expect(miniDiff(change(), 1, 3).truncated).toBe(true);
    });

    it('plans a revert from the earliest checkpoint at or after a message', () => {
        const checkpoints = [
            { sessionId: 's', messageIndex: 0, files: { a: 'a0' } },
            { sessionId: 's', messageIndex: 2, files: { a: 'a2', b: undefined } },
            { sessionId: 's', messageIndex: 4, files: { b: 'b4', c: 'c4' } },
            { sessionId: 'other', messageIndex: 2, files: { z: 'z' } }
        ];
        expect([...restorePlan(checkpoints, 's', 2).entries()]).toEqual([['a', 'a2'], ['b', undefined], ['c', 'c4']]);
        expect(restorePlan(checkpoints, 's', 5).size).toBe(0);
    });
});
