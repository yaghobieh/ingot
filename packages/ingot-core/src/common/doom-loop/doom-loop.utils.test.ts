import { describe, expect, it } from 'vitest';
import {
    detectDoom, differentApproachNudge, errorSignature, formatAntiHabits, observeEdit, observeReply, observeResult, parseAntiHabits, recordAntiHabit, serializeAntiHabits,
    startDoom, successClaim
} from './doom-loop.utils';
import type { DoomState } from './doom-loop.types';

const NOW = Date.UTC(2026, 9, 31, 12);
const FAIL_A = '/tmp/p/test.js:4\n  throw new AssertionError(...)\nAssertionError [ERR_ASSERTION]: add(1, 2) expected 3, got 4\n    at Object.<anonymous> (/tmp/p/test.js:4:8)\nExit code 1.';
const FAIL_A2 = '\u001b[31mAssertionError [ERR_ASSERTION]: add(1, 2) expected 3, got 5\u001b[0m\nExit code 1.';
const FAIL_B = 'TypeError: sum is not a function\n    at /tmp/p/math.js:2:3\nExit code 1.';

const run = (state: DoomState, output: string, failed = true): DoomState => observeResult(state, { action: 'Ran `node test.js`', failed, output });

describe('IDEA-304 doom-loop breaker', () => {
    it('reduces an error to a signature that survives small changes', () => {
        expect(errorSignature(FAIL_A)).toBe('assertionerror [err_assertion]: add(n, n) expected n, got n');
        expect(errorSignature(FAIL_A2)).toBe(errorSignature(FAIL_A));
        expect(errorSignature(FAIL_B)).toBe('typeerror: sum is not a function');
        expect(errorSignature('Error: Cannot find module \'/Users/me/app/src/x.js\'\nExit code 1.')).toBe("cannot find module '<path>'");
        expect(errorSignature('something odd\nlast line')).toBe('last line');
        expect(errorSignature('Error: expected 3 but got -1')).toBe(errorSignature('Error: expected 3 but got 4.5'));
    });

    it('pauses after the same error N times, with what was tried', () => {
        let state = startDoom();
        for (let i = 0; i < 2; i++) {
            state = observeEdit(state, 'math.js', `v${i}`);
            state = run(state, i ? FAIL_A2 : FAIL_A);
        }
        expect(detectDoom(state, 3)).toBeUndefined();
        state = run(observeEdit(state, 'math.js', 'v2'), FAIL_A);
        const verdict = detectDoom(state, 3)!;
        expect(verdict.kind).toBe('repeat');
        expect(verdict.reason).toBe('The same error came back 3 times: "assertionerror [err_assertion]: add(n, n) expected n, got n".');
        expect(verdict.tried).toEqual([
            'Edited math.js', 'Ran `node test.js` → "assertionerror [err_assertion]: add(n, n) expected n, got n"', 'Edited math.js',
            'Ran `node test.js` → "assertionerror [err_assertion]: add(n, n) expected n, got n"', 'Edited math.js', 'Ran `node test.js` → "assertionerror [err_assertion]: add(n, n) expected n, got n"'
        ]);
        expect(verdict.files).toEqual(['math.js']);
        expect(verdict.approach).toBe('Editing math.js then Ran `node test.js` while "assertionerror [err_assertion]: add(n, n) expected n, got n" kept failing');
        expect(differentApproachNudge(verdict)).toContain('Do not do that again.');
    });

    it('spots fix → break cycles by error and by file version', () => {
        let state = run(run(run(startDoom(), FAIL_A), FAIL_B), FAIL_A);
        expect(detectDoom(state, 5)).toMatchObject({ kind: 'cycle', signature: errorSignature(FAIL_A) });
        state = observeEdit(observeEdit(observeEdit(startDoom(), 'a.ts', 'one'), 'a.ts', 'two'), 'a.ts', 'one');
        expect(detectDoom(state, 5)).toMatchObject({ kind: 'cycle', reason: 'a.ts was put back to a version that had already been tried.' });
        expect(detectDoom(observeEdit(observeEdit(startDoom(), 'a.ts', 'one'), 'a.ts', 'one'), 5)).toBeUndefined();
    });

    it('counts "fixed" claims the next result disproves', () => {
        expect(successClaim('I fixed the off-by-one. The tests should pass now.')).toBe('I fixed the off-by-one.');
        expect(successClaim('Let me look at the error.')).toBeUndefined();
        let state = run(observeReply(startDoom(), 'Fixed it, tests pass now.'), FAIL_A);
        state = run(observeReply(state, 'Let me check.'), FAIL_B);
        expect(detectDoom(state, 5)).toBeUndefined();
        state = run(observeReply(state, 'This should work now.'), 'TypeError: other\nExit code 1.');
        expect(detectDoom(state, 5)).toMatchObject({ kind: 'claims', reason: 'The agent said it was fixed 2 times, but the next run failed each time.' });
        expect(detectDoom(run(observeReply(startDoom(), 'Fixed.'), 'ok', false), 5)).toBeUndefined();
    });

    it('keeps failed approaches as anti-habits in .ingot/anti-habits.md', () => {
        let state = startDoom();
        for (let i = 0; i < 3; i++) {
            state = run(observeEdit(state, 'math.js', `v${i}`), FAIL_A);
        }
        const verdict = detectDoom(state, 3)!;
        let { habits, habit } = recordAntiHabit([], verdict, NOW);
        expect(habit).toMatchObject({ files: ['math.js'], count: 1, at: '2026-10-31' });
        ({ habits, habit } = recordAntiHabit(habits, verdict, NOW));
        expect(habits).toHaveLength(1);
        expect(habit.count).toBe(2);
        const text = serializeAntiHabits(habits);
        expect(text).toContain("- Don't: Editing math.js then Ran `node test.js`");
        expect(parseAntiHabits(text)).toEqual(habits);
        expect(parseAntiHabits("# Anti-habits\n\n- Don't: Retry the flaky network mock\n")).toEqual([{ id: 'retry-the-flaky-network-mock', text: 'Retry the flaky network mock', files: [], count: 1, at: '' }]);
        expect(formatAntiHabits(habits)).toContain("Don't do this here");
        expect(formatAntiHabits([])).toBe('');
    });
});
