import { describe, expect, it } from 'vitest';
import { briefPath, briefPrompt, buildBrief, changesDiff, countFailures, countTurns, detectRot, freshTitle, offerAllowed, recentFailures, rotSummary } from './fresh-context.utils';
import { CONTINUE_PROMPT } from './fresh-context.consts';

const LIMITS = { turns: 12, failures: 3, ratio: 0.6 };
const user = (text: string, hidden = false) => ({ role: 'user', text, hidden });
const toolError = (text: string) => ({ role: 'tool', text, tool: { state: 'error' } });
const toolOk = (text: string) => ({ role: 'tool', text, tool: { state: 'done' } });

describe('IDEA-305 rot detection', () => {
    it('counts visible user turns and failures since the last one', () => {
        const messages = [
            user('a'), toolError('Error: old'), user('b'), user('auto', true),
            toolError('Error: npm test failed'), toolOk('ok'), { role: 'tool', text: 'Error: no such file' }, { role: 'system', text: 'The model request failed: 500' }
        ];
        expect(countTurns(messages)).toBe(2);
        expect(countFailures(messages)).toBe(3);
        expect(recentFailures(messages, 2)).toEqual(['no such file', 'The model request failed: 500']);
    });

    it('trips on failures, turns or context share', () => {
        expect(detectRot({ turns: 2, failures: 1, ratio: 0.1 }, LIMITS)).toBeUndefined();
        expect(detectRot({ turns: 2, failures: 3, ratio: 0.1 }, LIMITS)?.reasons).toEqual(['failures']);
        expect(detectRot({ turns: 14, failures: 0, ratio: 0.72 }, LIMITS)?.reasons).toEqual(['turns', 'tokens']);
    });

    it('summarises the verdict', () => {
        expect(rotSummary({ reasons: ['failures', 'turns', 'tokens'], signals: { turns: 14, failures: 3, ratio: 0.72 } })).toBe('3 failed attempts · 14 turns · 72% of context');
        expect(rotSummary({ reasons: ['failures'], signals: { turns: 1, failures: 1, ratio: 0 } })).toBe('1 failed attempt');
    });

    it('re-offers after a dismissal only a few turns later, or at once for failures', () => {
        const turns = { reasons: ['turns' as const], signals: { turns: 13, failures: 0, ratio: 0 } };
        expect(offerAllowed(turns, undefined)).toBe(true);
        expect(offerAllowed(turns, 12)).toBe(false);
        expect(offerAllowed({ ...turns, signals: { ...turns.signals, turns: 16 } }, 12)).toBe(true);
        expect(offerAllowed({ reasons: ['failures'], signals: { turns: 13, failures: 3, ratio: 0 } }, 12)).toBe(true);
    });
});

describe('IDEA-305 brief', () => {
    const verdict = { reasons: ['failures' as const], signals: { turns: 4, failures: 3, ratio: 0.2 } };

    it('names the file under .ingot/handoffs', () => {
        expect(briefPath('Fix the cart total!', new Date('2026-10-31T06:08:12Z'))).toBe('.ingot/handoffs/2026-10-31T06-08-12-fix-the-cart-total.md');
        expect(briefPath('???', new Date('2026-10-31T06:08:12Z'))).toBe('.ingot/handoffs/2026-10-31T06-08-12-chat.md');
    });

    it('marks the new chat as fresh once', () => {
        expect(freshTitle('Fix the cart')).toBe('Fix the cart (fresh)');
        expect(freshTitle('Fix the cart (fresh)')).toBe('Fix the cart (fresh)');
    });

    it('distils goal, plan, decisions, diff, failures and where it stopped', () => {
        const brief = buildBrief({
            title: 'Fix the cart', savedAt: '2026-10-31 06:08', goal: 'Fix the cart total', latest: 'Try again', verdict,
            plan: [{ text: 'Edit `src/cart.ts`', done: true }, { text: 'Run tests', done: false }],
            decisions: 'Use integer cents.', files: ['src/cart.ts'], diff: '--- a/src/cart.ts\n+++ b/src/cart.ts', failures: ['npm test failed'],
            lastReply: 'Tests still fail on rounding.'
        });
        expect(brief).toContain('# Handoff brief: Fix the cart');
        expect(brief).toContain('3 failed attempts');
        expect(brief).toContain('## Goal\n\nFix the cart total');
        expect(brief).toContain('## Latest request\n\nTry again');
        expect(brief).toContain('- [x] Edit `src/cart.ts`');
        expect(brief).toContain('- [ ] Run tests');
        expect(brief).toContain('Use integer cents.');
        expect(brief).toContain('```diff\n--- a/src/cart.ts');
        expect(brief).toContain('- npm test failed');
        expect(brief).toContain('## Where it stopped\n\nTests still fail on rounding.');
    });

    it('says what is missing instead of leaving sections empty', () => {
        const brief = buildBrief({ title: 'T', savedAt: 'now', goal: 'G', latest: 'G', verdict, plan: [], files: [], diff: '', failures: [], lastReply: '' });
        expect(brief).not.toContain('## Latest request');
        expect(brief).toContain('No plan was written');
        expect(brief).toContain('No .ingot/decisions.md');
        expect(brief).toContain('No files changed yet.');
        expect(brief).not.toContain('```diff');
    });

    it('diffs the chat changes compactly', () => {
        expect(changesDiff([{ path: 'a.ts', oldText: 'one\ntwo\n', newText: 'one\nTWO\n' }])).toBe('--- a/a.ts\n+++ b/a.ts\n@@ -2,1 +2,1 @@\n-two\n+TWO');
        expect(changesDiff([])).toBe('');
    });

    it('wraps the brief as the fresh chat first turn', () => {
        const prompt = briefPrompt('.ingot/handoffs/x.md', '# Brief');
        expect(prompt).toContain('.ingot/handoffs/x.md');
        expect(prompt.endsWith(CONTINUE_PROMPT)).toBe(true);
    });
});
