import { describe, expect, it } from 'vitest';
import { checkpoints, excerptAt, formatCountdown, formatReviewComments, resolvedIds, reviewSettings, REVIEW_PREFS, type ReviewComment } from './review';

describe('agent review (IDEA-105)', () => {
    it('defaults: on, pause after 10 files, continue after 120 s, no auto-accept, inline comments', () => {
        expect(reviewSettings(() => undefined)).toEqual({ enabled: true, pauseThreshold: 10, autoContinueSeconds: 120, autoAccept: false, inlineComments: true });
    });
    it('review off: no pause, no countdown, edits are accepted, no comments', () => {
        expect(reviewSettings(k => (k === REVIEW_PREFS.enabled ? false : 3))).toEqual({ enabled: false, pauseThreshold: 0, autoContinueSeconds: 0, autoAccept: true, inlineComments: false });
    });
    it('ignores bad numbers', () => {
        expect(reviewSettings(k => (k === REVIEW_PREFS.pauseThreshold ? -4 : k === REVIEW_PREFS.autoContinueSeconds ? 'x' : undefined))).toMatchObject({ pauseThreshold: 10, autoContinueSeconds: 120 });
    });
    it('splits edits into checkpoints', () => {
        const edits = Array.from({ length: 23 }, (_, i) => i);
        expect(checkpoints(edits, 10).map(b => b.length)).toEqual([10, 10, 3]);
        expect(checkpoints(edits, 0)).toHaveLength(1);
        expect(checkpoints(edits.slice(0, 10), 10)).toHaveLength(1);
        expect(checkpoints([], 10)).toEqual([]);
    });
    it('formats the countdown', () => {
        expect(formatCountdown(102)).toBe('1:42');
        expect(formatCountdown(5.2)).toBe('0:06');
        expect(formatCountdown(-1)).toBe('0:00');
    });
    it('formats comments for the agent and reads resolved ids back', () => {
        const base = { sessionId: 's', uri: 'file:///p/a.ts', state: 'draft' as const };
        const comments: ReviewComment[] = [
            { ...base, id: 'c2', path: 'b.ts', line: 3, excerpt: 'const b = 1;', text: 'Rename b' },
            { ...base, id: 'c1', path: 'a.ts', line: 7, excerpt: 'x\ny', text: 'Handle null' }
        ];
        const text = formatReviewComments(comments);
        expect(text).toContain('Review comments (2)');
        expect(text.indexOf('### a.ts')).toBeLessThan(text.indexOf('### b.ts'));
        expect(text).toContain('- [c1] line 7:');
        expect(text).toContain('  Handle null');
        expect(resolvedIds('Done [resolved: c1] and [Resolved:c2].')).toEqual(['c1', 'c2']);
    });
    it('takes an excerpt around a line', () => {
        expect(excerptAt('a\nb\nc\nd', 2)).toBe('a\nb\nc');
        expect(excerptAt('a\nb', 1, 0)).toBe('a');
    });
});
