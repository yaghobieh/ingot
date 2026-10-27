import { describe, expect, it } from 'vitest';
import { AI_COMMIT_TEXT, TRUNCATED_MARK, aiCommitError, cleanCommitMessage, commitMessagePrompt, newFileDiff, splitDiffFiles, truncateDiff } from './ai-commit';

const file = (name: string, body: string) => `diff --git a/${name} b/${name}\n--- a/${name}\n+++ b/${name}\n@@ -1 +1 @@\n${body}\n`;

describe('IDEA-176 Commit with AI helpers', () => {
    it('splits a diff per file', () => {
        expect(splitDiffFiles(file('a.ts', '+a') + file('b.ts', '+b'))).toHaveLength(2);
        expect(splitDiffFiles('')).toEqual([]);
    });

    it('keeps small diffs as they are', () => {
        const diff = file('a.ts', '+a');
        expect(truncateDiff(diff)).toEqual({ text: diff, truncated: false });
    });

    it('caps a huge file but keeps the other files', () => {
        const big = file('big.ts', Array.from({ length: 2000 }, (_, i) => `+line ${i}`).join('\n'));
        const out = truncateDiff(big + file('small.ts', '+s'), 3000, 1000);
        expect(out.truncated).toBe(true);
        expect(out.text).toContain(TRUNCATED_MARK);
        expect(out.text).toContain('diff --git a/small.ts');
        expect(out.text.length).toBeLessThanOrEqual(3000);
    });

    it('lists file headers once the total budget is used', () => {
        const files = Array.from({ length: 10 }, (_, i) => file(`f${i}.ts`, '+'.padEnd(500, 'x'))).join('');
        const out = truncateDiff(files, 2000, 1000);
        expect(out.truncated).toBe(true);
        expect(out.text.length).toBeLessThanOrEqual(2000);
        expect(out.text).toContain('diff --git a/f0.ts');
    });

    it('turns a new file into a diff', () => {
        expect(newFileDiff('n.md', '# hi\nthere\n')).toContain('+++ b/n.md\n@@ -0,0 +1,2 @@\n+# hi\n+there\n');
    });

    it('builds a short prompt that mentions truncation', () => {
        const [system, user] = commitMessagePrompt({ text: 'diff', truncated: true }, 'main');
        expect(system.role).toBe('system');
        expect(user.content).toContain('Branch: main');
        expect(user.content).toContain('shortened');
    });

    it('cleans fences, labels and quotes', () => {
        expect(cleanCommitMessage('```\nFix cart total\n```')).toBe('Fix cart total');
        expect(cleanCommitMessage('Commit message: Add qty')).toBe('Add qty');
        expect(cleanCommitMessage('"Add qty"')).toBe('Add qty');
        expect(cleanCommitMessage('### Add qty')).toBe('Add qty');
        expect(cleanCommitMessage('Add qty\n\n- keep "rollback"')).toBe('Add qty\n\n- keep "rollback"');
    });

    it('maps gateway errors to friendly text', () => {
        expect(aiCommitError(new Error('Sign in to use Ingot models'))).toBe(AI_COMMIT_TEXT.signedOut);
        expect(aiCommitError(new Error('TypeError: fetch failed'))).toBe(AI_COMMIT_TEXT.offline);
        expect(aiCommitError(new Error('Out of tokens'))).toBe('Out of tokens');
    });
});
