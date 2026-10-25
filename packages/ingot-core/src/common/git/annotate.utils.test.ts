import { describe, expect, it } from 'vitest';
import { ageBuckets, annotationLabel, parseCommitInfo, parseLineHistory, previousRevision, shortDate, UNCOMMITTED_HASH } from './annotate.utils';
import type { GitBlameLine } from './git.types';

const line = (hash: string, date: string, author = 'Ada Lovelace', n = 1): GitBlameLine => ({ line: n, hash, author, date, summary: 's' });

describe('annotate utils', () => {
    it('buckets commits by age, newest first', () => {
        const b = ageBuckets([line('a', '2026-10-24T00:00:00Z'), line('b', '2026-01-01T00:00:00Z'), line('c', '2025-01-01T00:00:00Z')]);
        expect(b.get('a')).toBe(0);
        expect(b.get('c')).toBe(4);
        expect(b.get('b')).toBeGreaterThan(0);
        expect(ageBuckets([line('a', '2026-10-24T00:00:00Z')]).get('a')).toBe(0);
    });
    it('formats the gutter label', () => {
        expect(shortDate('2026-10-24T10:00:00')).toBe('2026-10-24');
        expect(annotationLabel(line('a', '2026-10-24T10:00:00'), 7)).toBe('2026-10-24 Ada Lovelace    7');
        expect(annotationLabel(line('a', '2026-10-24T10:00:00', 'Bartholomew Longname'), 12)).toBe('2026-10-24 Bartholomew…   12');
        expect(annotationLabel(line(UNCOMMITTED_HASH, '', 'You'), 3)).toContain('Today      You');
        expect(annotationLabel(undefined, 3)).toBe(`${' '.repeat(23)}    3`);
    });
    it('parses commit details and line history', () => {
        expect(parseCommitInfo('abc\x1fAda\x1fada@x.dev\x1f2026-10-24T10:00:00+03:00\x1fSubject\n\nBody line\n')).toEqual({
            hash: 'abc', author: 'Ada', email: 'ada@x.dev', date: '2026-10-24T10:00:00+03:00', message: 'Subject\n\nBody line'
        });
        expect(parseCommitInfo('')).toBeUndefined();
        const history = parseLineHistory('h2\x1fs2\x1fAda\x1f2026-10-24\x1fSecond\nh1\x1fs1\x1fBob\x1f2026-01-01\x1fFirst\n');
        expect(history.map(h => h.subject)).toEqual(['Second', 'First']);
        expect(previousRevision('abc')).toBe('abc~1');
    });
});
