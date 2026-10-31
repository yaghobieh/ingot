import { describe, expect, it } from 'vitest';
import { REVIEW_BUDGET } from './code-review.consts';
import { budgetChunks, fixPrompt, parseFindings, parsePullRequestRef, parseUnifiedDiff, reviewDiff, severityCounts, sortFindings, toSeverity } from './code-review.utils';
import type { ReviewFinding, ReviewModel } from './code-review.types';

const DIFF = [
    'diff --git a/src/math.ts b/src/math.ts',
    'index 1111111..2222222 100644',
    '--- a/src/math.ts',
    '+++ b/src/math.ts',
    '@@ -1,3 +1,4 @@',
    ' export const add = (a: number, b: number): number => a + b;',
    '-export const sub = (a: number, b: number): number => a - b;',
    '+export const sub = (a: number, b: number): number => b - a;',
    '+export const div = (a: number, b: number): number => a / b;',
    ' export const one = 1;',
    'diff --git a/old.txt b/old.txt',
    'deleted file mode 100644',
    '--- a/old.txt',
    '+++ /dev/null',
    '@@ -1 +0,0 @@',
    '-gone',
    'diff --git a/src/new.ts b/src/new.ts',
    'new file mode 100644',
    '--- /dev/null',
    '+++ b/src/new.ts',
    '@@ -0,0 +1,2 @@',
    '+const token = "abc";',
    '+export default token;'
].join('\n');

const finding = (patch: Partial<ReviewFinding>): ReviewFinding => ({ id: 'x', path: 'a.ts', line: 1, severity: 'medium', title: 't', detail: '', ...patch });
const fakeModel = (replies: (string | Error)[]): ReviewModel & { prompts: string[] } => {
    const model = {
        prompts: [] as string[],
        complete: async (_system: string, user: string) => {
            model.prompts.push(user);
            const reply = replies.shift() ?? '[]';
            if (reply instanceof Error) {
                throw reply;
            }
            return reply;
        }
    };
    return model;
};

describe('IDEA-293 diff parsing', () => {
    it('finds files, added lines and deletions', () => {
        const files = parseUnifiedDiff(DIFF);
        expect(files.map(f => [f.path, f.added, f.deleted])).toEqual([
            ['src/math.ts', [2, 3], false],
            ['old.txt', [], true],
            ['src/new.ts', [1, 2], false]
        ]);
    });

    it('keeps the review within the call budget and lists what it skipped', () => {
        const files = parseUnifiedDiff(DIFF);
        const tight = { ...REVIEW_BUDGET, maxChunkChars: files[0].text.length, maxCalls: 1 };
        const { chunks, skipped } = budgetChunks(files, tight);
        expect(chunks.map(c => c.map(f => f.path))).toEqual([['src/math.ts']]);
        expect(skipped).toEqual(['src/new.ts']);
        expect(budgetChunks(files, REVIEW_BUDGET).chunks).toHaveLength(1);
    });
});

describe('IDEA-293 findings', () => {
    const files = parseUnifiedDiff(DIFF);

    it('parses the JSON reply, snaps lines to changed lines and drops unknown files', () => {
        const reply = 'Here you go:\n```json\n[{"path":"src/math.ts","line":2,"severity":"error","title":"sub is reversed","detail":"returns b - a"},' +
            '{"path":"b/src/new.ts","line":9,"severity":"nit","title":"hard-coded token"},{"path":"nope.ts","line":1,"title":"x"},{"path":"src/math.ts","line":3}]\n```';
        expect(parseFindings(reply, files)).toEqual([
            { id: 'f-1', path: 'src/math.ts', line: 2, severity: 'high', title: 'sub is reversed', detail: 'returns b - a' },
            { id: 'f-2', path: 'src/new.ts', line: 2, severity: 'low', title: 'hard-coded token', detail: '' }
        ]);
        expect(parseFindings('no findings', files)).toEqual([]);
        expect(parseFindings('[not json', files)).toEqual([]);
    });

    it('maps severities, sorts and dedupes', () => {
        expect(toSeverity('Blocker')).toBe('critical');
        expect(toSeverity('whatever')).toBe('medium');
        const sorted = sortFindings([finding({ severity: 'low', path: 'b.ts' }), finding({ severity: 'critical' }), finding({ severity: 'critical', title: 'T' })]);
        expect(sorted.map(f => f.severity)).toEqual(['critical', 'low']);
        expect(severityCounts(sorted)).toEqual({ critical: 1, high: 0, medium: 0, low: 1 });
    });
});

describe('IDEA-293 reviewDiff', () => {
    it('calls the model once per chunk with the capped token budget and collects findings', async () => {
        const model = fakeModel(['[{"path":"src/math.ts","line":2,"severity":"high","title":"sub is reversed"}]']);
        const outcome = await reviewDiff(DIFF, 'Local changes', model, REVIEW_BUDGET);
        expect(outcome.calls).toBe(1);
        expect(model.prompts[0]).toContain('Review this diff (Local changes).');
        expect(outcome.findings.map(f => f.title)).toEqual(['sub is reversed']);
        expect(outcome.reviewedFiles).toEqual(['src/math.ts', 'src/new.ts']);
    });

    it('reports a failed call and makes no call for an empty diff', async () => {
        const failing = await reviewDiff(DIFF, 'x', fakeModel([new Error('rate limited')]), REVIEW_BUDGET);
        expect(failing.errors).toEqual(['rate limited']);
        const empty = fakeModel([]);
        expect((await reviewDiff('', 'x', empty, REVIEW_BUDGET)).calls).toBe(0);
        expect(empty.prompts).toEqual([]);
    });
});

describe('IDEA-293 pull request refs and fix prompt', () => {
    it('reads numbers and URLs', () => {
        expect(parsePullRequestRef('#42')).toEqual({ number: 42 });
        expect(parsePullRequestRef(' 7 ')).toEqual({ number: 7 });
        expect(parsePullRequestRef('https://github.com/acme/app/pull/115/files')).toEqual({ number: 115, repo: 'acme/app' });
        expect(parsePullRequestRef('main')).toBeUndefined();
    });

    it('builds the Fix with agent prompt', () => {
        expect(fixPrompt(finding({ path: 'src/math.ts', line: 2, severity: 'high', title: 'sub is reversed', detail: 'Use a - b.' })))
            .toBe('Fix this code review finding in src/math.ts at line 2 (high): sub is reversed\n\nUse a - b.\n\nRead the file first, keep the change minimal, and do not change unrelated code.');
    });
});
