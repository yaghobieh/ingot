import { describe, expect, it } from 'vitest';
import { GOAL_DEFAULTS, GOAL_LIMITS } from './goal.consts';
import { applyGoalCheck, createGoal, decideGoal, goalLimits, goalProgress, goalProtocol, parseGoalCheck, parseGoalCommand, restoreGoal } from './goal';

const limits = { maxIterations: 3, tokenBudget: 1_000 };

describe('goal command', () => {
    it('parses the objective and explicit done criteria', () => {
        expect(parseGoalCommand('/goal Fix the cart total. Done when: npm test passes; lint is clean')).toEqual({
            objective: 'Fix the cart total',
            criteria: ['npm test passes', 'lint is clean']
        });
        expect(parseGoalCommand('/goal ship it\ndone when:\n- a\n- b')).toEqual({ objective: 'ship it', criteria: ['a', 'b'] });
    });

    it('ignores other prompts and keeps an empty objective for the usage line', () => {
        expect(parseGoalCommand('/goals now')).toBeUndefined();
        expect(parseGoalCommand('fix the goal')).toBeUndefined();
        expect(parseGoalCommand('/goal')).toEqual({ objective: '', criteria: [] });
    });

    it('clamps the limits from settings', () => {
        expect(goalLimits(() => undefined)).toEqual(GOAL_DEFAULTS);
        expect(goalLimits(key => (key === 'maxIterations' ? 999 : 1))).toEqual({ maxIterations: GOAL_LIMITS.maxIterations, tokenBudget: GOAL_LIMITS.minBudget });
    });
});

describe('goal self-check', () => {
    it('reads the last GOAL CHECK block', () => {
        const reply = 'Working.\nGOAL CHECK:\n- [ ] old\nGOAL: CONTINUE\nMore.\nGOAL CHECK:\n- [x] tests pass (npm test exit 0)\n- [ ] docs updated\nGOAL: CONTINUE';
        expect(parseGoalCheck(reply)).toEqual({
            criteria: [{ text: 'tests pass (npm test exit 0)', met: true }, { text: 'docs updated', met: false }],
            verdict: 'continue'
        });
        expect(parseGoalCheck('no block here')).toEqual({ criteria: [] });
    });

    it('is done only when the reply says DONE and every box is checked', () => {
        const goal = createGoal({ objective: 'x', criteria: [] }, limits, 0);
        const half = parseGoalCheck('GOAL CHECK\n- [x] a\n- [ ] b\nGOAL: DONE');
        const next = applyGoalCheck(goal, half, 100);
        const decision = decideGoal(next, half);
        expect(decision.kind).toBe('continue');
        expect(decision.kind === 'continue' && decision.nudge).toContain('- [ ] b');
        const full = parseGoalCheck('GOAL CHECK\n- [x] a\n- [x] b\nGOAL: DONE');
        expect(decideGoal(applyGoalCheck(next, full, 100), full)).toEqual({ kind: 'done' });
    });

    it('asks for the block when a reply has none', () => {
        const goal = applyGoalCheck(createGoal({ objective: 'x', criteria: ['a'] }, limits, 0), { criteria: [] }, 10);
        expect(goal.criteria).toEqual([{ text: 'a', met: false }]);
        const decision = decideGoal(goal, { criteria: [] });
        expect(decision.kind === 'continue' && decision.nudge).toContain('no GOAL CHECK block');
    });

    it('stops at max iterations and at the budget cap', () => {
        let goal = createGoal({ objective: 'x', criteria: ['a'] }, limits, 0);
        const open = parseGoalCheck('GOAL CHECK\n- [ ] a\nGOAL: CONTINUE');
        for (let i = 0; i < limits.maxIterations; i++) {
            goal = applyGoalCheck(goal, open, 1);
        }
        expect(decideGoal(goal, open)).toMatchObject({ kind: 'stop', reason: 'iterations' });
        const spent = applyGoalCheck(createGoal({ objective: 'x', criteria: [] }, limits, 0), open, limits.tokenBudget);
        expect(decideGoal(spent, open)).toMatchObject({ kind: 'stop', reason: 'budget' });
    });
});

describe('goal display', () => {
    it('reports progress from criteria, then iterations', () => {
        const goal = createGoal({ objective: 'x', criteria: [] }, limits, 0);
        expect(goalProgress(goal)).toBe(0);
        expect(goalProgress({ ...goal, iteration: 1 })).toBeCloseTo(1 / 3);
        expect(goalProgress({ ...goal, criteria: [{ text: 'a', met: true }, { text: 'b', met: false }] })).toBe(0.5);
        expect(goalProgress({ ...goal, state: 'done' })).toBe(1);
    });

    it('puts the objective and the check format in the system prompt', () => {
        const text = goalProtocol(createGoal({ objective: 'Fix it', criteria: ['tests pass'] }, limits, 0));
        expect(text).toContain('Objective: Fix it');
        expect(text).toContain('- tests pass');
        expect(text).toContain('GOAL: DONE');
    });

    it('shows a running goal as stopped after a reload', () => {
        const goal = createGoal({ objective: 'x', criteria: [] }, limits, 0);
        expect(restoreGoal(goal)).toMatchObject({ state: 'stopped', reason: 'user' });
        expect(restoreGoal({ ...goal, state: 'done' })?.state).toBe('done');
        expect(restoreGoal(undefined)).toBeUndefined();
    });
});
