import { describe, expect, it } from 'vitest';
import { diffStats, lineDiff } from './diff.utils';

describe('lineDiff', () => {
    it('finds replaced lines', () => {
        const hunks = lineDiff('a\nb\nc', 'a\nB1\nB2\nc');
        expect(hunks).toEqual([{ newStart: 1, oldStart: 1, removed: ['b'], added: ['B1', 'B2'] }]);
        expect(diffStats(hunks)).toEqual({ added: 2, removed: 1 });
    });

    it('handles pure insertions and deletions', () => {
        expect(lineDiff('a\nc', 'a\nb\nc')).toEqual([{ newStart: 1, oldStart: 1, removed: [], added: ['b'] }]);
        expect(lineDiff('a\nb\nc', 'a\nc')).toEqual([{ newStart: 1, oldStart: 1, removed: ['b'], added: [] }]);
    });

    it('returns nothing for identical text', () => {
        expect(lineDiff('x\ny', 'x\ny')).toEqual([]);
    });
});
