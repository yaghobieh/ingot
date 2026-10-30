import { describe, expect, it } from 'vitest';
import { extractFollowUps, fallbackFollowUps, followUpsFor, normalizeFollowUps } from './follow-ups';
import { FALLBACK_FOLLOW_UPS } from './follow-ups.consts';

describe('follow-ups (IDEA-267)', () => {
    it('takes the NEXT line out of the reply and splits it into actions', () => {
        const out = extractFollowUps('Fixed `sum`.\nTests pass.\nNEXT: Add a test for negatives | Commit the fix | "Explain the bug".');
        expect(out.display).toBe('Fixed `sum`.\nTests pass.');
        expect(out.followUps).toEqual(['Add a test for negatives', 'Commit the fix', 'Explain the bug']);
    });

    it('accepts bold or lower-case markers and hides a NEXT line that is still streaming', () => {
        expect(extractFollowUps('Done.\n**Next:** Run the tests | Deploy').followUps).toEqual(['Run the tests', 'Deploy']);
        expect(extractFollowUps('Done.\nNEX').display).toBe('Done.');
        expect(extractFollowUps('Done.\nnext: one more').followUps).toEqual(['one more']);
        expect(extractFollowUps('Next, I read the file.').display).toBe('Next, I read the file.');
    });

    it('drops duplicates, empty and overlong items, and caps the list', () => {
        expect(normalizeFollowUps(['a', 'Run tests', 'run tests', 'x'.repeat(200), 'One', 'Two', 'Three'])).toEqual(['Run tests', 'One', 'Two']);
    });

    it('falls back on what the turn did', () => {
        expect(fallbackFollowUps({ edited: true, checks: 'failed' })).toEqual([...FALLBACK_FOLLOW_UPS.checksFailed]);
        expect(fallbackFollowUps({ edited: true, checks: 'passed' })).toEqual([...FALLBACK_FOLLOW_UPS.checksPassed]);
        expect(fallbackFollowUps({ edited: true, checks: 'none' })).toEqual([...FALLBACK_FOLLOW_UPS.edited]);
        expect(fallbackFollowUps({ edited: false, checks: 'none' })).toEqual([...FALLBACK_FOLLOW_UPS.answered]);
        expect(followUpsFor(['Ship it'], { edited: false, checks: 'none' })).toEqual(['Ship it']);
    });
});
