import { describe, expect, it } from 'vitest';
import { BUGBOT_COMMENT_MARKER, REVIEW_BUDGET } from './code-review.consts';
import { bugbotCommentBody, parseBugbotPrompt, reviewDiff } from './code-review.utils';
import type { ReviewFinding, ReviewModel } from './code-review.types';

const finding = (severity: ReviewFinding['severity'], title: string, line = 2): ReviewFinding => ({ id: `f-${line}`, path: 'src/a.ts', line, severity, title, detail: 'Fix | it.' });

describe('IDEA-287 /bugbot', () => {
    it('reads pull requests, local reviews and extra instructions from the prompt', () => {
        expect(parseBugbotPrompt('/bugbot #12')).toEqual({ kind: 'pr', ref: '#12' });
        expect(parseBugbotPrompt('/bugbot pr 7')).toEqual({ kind: 'pr', ref: '7' });
        expect(parseBugbotPrompt('/BUGBOT https://github.com/o/r/pull/3')).toEqual({ kind: 'pr', ref: 'https://github.com/o/r/pull/3' });
        expect(parseBugbotPrompt('/bugbot')).toEqual({ kind: 'local' });
        expect(parseBugbotPrompt('/bugbot run')).toEqual({ kind: 'local' });
        expect(parseBugbotPrompt('/bugbot focus on auth')).toEqual({ kind: 'instructions', text: 'focus on auth' });
        expect(parseBugbotPrompt('/bugbots')).toBeUndefined();
        expect(parseBugbotPrompt('review #12')).toBeUndefined();
    });

    it('writes a PR comment with a summary and a table, escaping table characters', () => {
        const body = bugbotCommentBody('PR #12 (o/r)', [finding('low', 'Nit', 4), finding('high', 'Wrong order')], ['src/a.ts'], 'Qwen');
        expect(body.startsWith(BUGBOT_COMMENT_MARKER)).toBe(true);
        expect(body).toContain('Found 2 issues (1 high, 1 low) in PR #12 (o/r).');
        expect(body.indexOf('Wrong order')).toBeLessThan(body.indexOf('Nit'));
        expect(body).toContain('| High | `src/a.ts:2` | **Wrong order** Fix \\| it. |');
        expect(body).toContain('Reviewed by Ingot with Qwen.');
        expect(bugbotCommentBody('PR #1', [], ['a.ts', 'b.ts'])).toContain('No problems found in 2 files of PR #1.');
    });

    it('adds BUGBOT.md guidance to the review prompt', async () => {
        const systems: string[] = [];
        const model: ReviewModel = { complete: async system => { systems.push(system); return '[]'; } };
        const diff = 'diff --git a/x.ts b/x.ts\n--- a/x.ts\n+++ b/x.ts\n@@ -0,0 +1 @@\n+const x = 1;\n';
        await reviewDiff(diff, 'Local changes', model, REVIEW_BUDGET, 'Also follow BUGBOT-RULE.');
        await reviewDiff(diff, 'Local changes', model, REVIEW_BUDGET);
        expect(systems[0]).toContain('Also follow BUGBOT-RULE.');
        expect(systems[1]).not.toContain('BUGBOT-RULE');
    });
});
