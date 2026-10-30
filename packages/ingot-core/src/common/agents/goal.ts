/**
 * IDEA-292: pure decisions for `/goal`. The store runs the turns; this module parses the command,
 * reads the reply's self-check and decides whether the agent continues, stops or is done.
 */
import {
    GOAL_BUDGET_TEXT, GOAL_CHECK_HEADING, GOAL_CHECK_PATTERN, GOAL_COMMAND_PATTERN, GOAL_CONTINUE_PREFIX, GOAL_CRITERIA_SEPARATOR, GOAL_CRITERION_PATTERN,
    GOAL_DEFAULTS, GOAL_DONE_WHEN_PATTERN, GOAL_ITERATIONS_TEXT, GOAL_LIMITS, GOAL_VERDICT_PATTERN
} from './goal.consts';
import type { AgentGoal, GoalCheck, GoalCommand, GoalCriterion, GoalDecision, GoalLimits, GoalVerdict } from './goal.types';

/** `/goal <objective> [done when: a; b]`, or undefined when the prompt is not a goal. An empty objective is allowed (shows usage). */
export const parseGoalCommand = (prompt: string): GoalCommand | undefined => {
    const match = GOAL_COMMAND_PATTERN.exec(prompt.trim());
    if (!match) {
        return undefined;
    }
    const body = (match[1] ?? '').trim();
    const at = body.search(GOAL_DONE_WHEN_PATTERN);
    if (at < 0) {
        return { objective: body, criteria: [] };
    }
    const objective = body.slice(0, at).trim().replace(/[.,;:]+$/, '');
    const rest = body.slice(at).replace(GOAL_DONE_WHEN_PATTERN, '');
    const criteria = rest.split(GOAL_CRITERIA_SEPARATOR).map(item => item.replace(/^[-*]\s*/, '').trim()).filter(Boolean);
    return { objective, criteria };
};

const clamp = (value: unknown, min: number, max: number, fallback: number): number =>
    typeof value === 'number' && Number.isFinite(value) ? Math.min(max, Math.max(min, Math.floor(value))) : fallback;

export const goalLimits = (read: (key: 'maxIterations' | 'tokenBudget') => unknown): GoalLimits => ({
    maxIterations: clamp(read('maxIterations'), GOAL_LIMITS.minIterations, GOAL_LIMITS.maxIterations, GOAL_DEFAULTS.maxIterations),
    tokenBudget: clamp(read('tokenBudget'), GOAL_LIMITS.minBudget, GOAL_LIMITS.maxBudget, GOAL_DEFAULTS.tokenBudget)
});

export const createGoal = (command: GoalCommand, limits: GoalLimits, now: number): AgentGoal => ({
    objective: command.objective,
    criteria: command.criteria.map(text => ({ text, met: false })),
    iteration: 0,
    maxIterations: limits.maxIterations,
    tokenBudget: limits.tokenBudget,
    tokensUsed: 0,
    state: 'running',
    startedAt: now
});

/** The last `GOAL CHECK` block in a reply: its checkboxes and the `GOAL: DONE|CONTINUE` verdict. */
export const parseGoalCheck = (reply: string): GoalCheck => {
    const heads = [...reply.matchAll(GOAL_CHECK_PATTERN)];
    const last = heads[heads.length - 1];
    if (!last || last.index === undefined) {
        return { criteria: [] };
    }
    const block = reply.slice(last.index + last[0].length);
    const criteria: GoalCriterion[] = [];
    for (const line of block.split('\n')) {
        const item = GOAL_CRITERION_PATTERN.exec(line);
        if (item) {
            criteria.push({ text: item[2], met: item[1].toLowerCase() === 'x' });
        }
    }
    const verdicts = [...block.matchAll(GOAL_VERDICT_PATTERN)];
    const verdict = verdicts[verdicts.length - 1]?.[1].toLowerCase() as GoalVerdict | undefined;
    return { criteria, ...(verdict ? { verdict } : {}) };
};

/** One finished turn: the self-check replaces the criteria (when it has any) and the iteration count goes up. */
export const applyGoalCheck = (goal: AgentGoal, check: GoalCheck, tokens: number): AgentGoal => ({
    ...goal,
    criteria: check.criteria.length ? check.criteria : goal.criteria,
    iteration: goal.iteration + 1,
    tokensUsed: goal.tokensUsed + Math.max(0, tokens)
});

export const goalMetCount = (goal: Pick<AgentGoal, 'criteria'>): number => goal.criteria.filter(item => item.met).length;

/** 0..1 for the banner bar: criteria met, or iterations used before the agent has listed any. */
export const goalProgress = (goal: Pick<AgentGoal, 'criteria' | 'iteration' | 'maxIterations' | 'state'>): number => {
    if (goal.state === 'done') {
        return 1;
    }
    if (goal.criteria.length) {
        return goalMetCount(goal) / goal.criteria.length;
    }
    return goal.maxIterations ? Math.min(1, goal.iteration / goal.maxIterations) : 0;
};

export const goalAllMet = (goal: Pick<AgentGoal, 'criteria'>): boolean => goal.criteria.length > 0 && goal.criteria.every(item => item.met);

const openList = (goal: AgentGoal): string => goal.criteria.filter(item => !item.met).map(item => `- [ ] ${item.text}`).join('\n');

/** After `applyGoalCheck`: done only when the reply says DONE and every listed criterion is checked. */
export const decideGoal = (goal: AgentGoal, check: GoalCheck): GoalDecision => {
    if (check.verdict === 'done' && goalAllMet(goal)) {
        return { kind: 'done' };
    }
    if (goal.iteration >= goal.maxIterations) {
        return { kind: 'stop', reason: 'iterations', message: GOAL_ITERATIONS_TEXT };
    }
    if (goal.tokensUsed >= goal.tokenBudget) {
        return { kind: 'stop', reason: 'budget', message: GOAL_BUDGET_TEXT };
    }
    const why = !check.criteria.length
        ? `Your reply had no ${GOAL_CHECK_HEADING} block. List the done criteria as checkboxes and check each one against real evidence.`
        : check.verdict === 'done'
            ? 'You wrote GOAL: DONE, but these criteria are not checked yet:'
            : `${goalMetCount(goal)} of ${goal.criteria.length} criteria met. Still open:`;
    return {
        kind: 'continue',
        nudge: [
            GOAL_CONTINUE_PREFIX,
            `Iteration ${goal.iteration + 1} of ${goal.maxIterations}. Objective: ${goal.objective}`,
            why,
            check.criteria.length ? openList(goal) : '',
            `Keep working: use the tools, verify with real output, then end with the ${GOAL_CHECK_HEADING} block.`
        ].filter(Boolean).join('\n')
    };
};

/** System prompt section for a running goal. */
export const goalProtocol = (goal: AgentGoal): string => [
    `GOAL MODE. Objective: ${goal.objective}`,
    `You keep working in a loop (up to ${goal.maxIterations} turns) until every done criterion is met and verified.`,
    goal.criteria.length
        ? `Done criteria:\n${goal.criteria.map(item => `- ${item.text}`).join('\n')}`
        : 'First, write 2 to 5 explicit, checkable done criteria (for example "npm test passes").',
    'Check each criterion against real evidence (tool output, file contents), never from memory.',
    `End EVERY reply with this block:\n${GOAL_CHECK_HEADING}:\n- [x] a criterion that is met (evidence)\n- [ ] a criterion that is not met yet\nGOAL: DONE (only when every box is checked) or GOAL: CONTINUE`
].join('\n');

/** Running goals do not survive a reload: the loop is gone, so they show as stopped. */
export const restoreGoal = (goal: AgentGoal | undefined): AgentGoal | undefined =>
    goal?.state === 'running' ? { ...goal, state: 'stopped', reason: 'user' } : goal;
