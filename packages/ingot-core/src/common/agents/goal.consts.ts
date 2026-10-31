/** IDEA-292: `/goal <objective>` keeps the agent working until its done criteria pass. */

export const GOAL_COMMAND = 'goal';
export const GOAL_USAGE = 'Usage: /goal <objective>. Add "done when: a; b" to set the done criteria yourself.';

export const GOAL_PREFS = {
    maxIterations: 'ingot.agent.goal.maxIterations',
    tokenBudget: 'ingot.agent.goal.tokenBudget'
} as const;

export const GOAL_DEFAULTS = {
    maxIterations: 8,
    tokenBudget: 200_000
} as const;

export const GOAL_LIMITS = {
    minIterations: 1,
    maxIterations: 50,
    minBudget: 1_000,
    maxBudget: 5_000_000
} as const;

export const GOAL_CHECK_HEADING = 'GOAL CHECK';
export const GOAL_CHECK_PATTERN = /GOAL CHECK:?/gi;
export const GOAL_VERDICT_PATTERN = /GOAL:\s*(DONE|CONTINUE)\b/gi;
export const GOAL_CRITERION_PATTERN = /^\s*[-*]\s*\[( |x|X)\]\s*(.+?)\s*$/;
export const GOAL_DONE_WHEN_PATTERN = /\bdone when:?/i;
export const GOAL_COMMAND_PATTERN = /^\/goal(?:\s+([\s\S]*))?$/i;
export const GOAL_CRITERIA_SEPARATOR = /\s*(?:;|\n)\s*(?:[-*]\s*)?/;

/** Banner state text for a stopped goal, by reason. */
export const GOAL_STOP_LABELS = {
    iterations: 'Out of iterations',
    budget: 'Budget reached',
    user: 'Stopped',
    error: 'Stopped on an error'
} as const;
export const PERCENT = 100;

export const GOAL_CONTINUE_PREFIX = 'Goal not done yet.';
export const GOAL_DONE_TEXT = 'Goal reached: every done criterion is checked.';
export const GOAL_STOPPED_TEXT = 'Goal stopped.';
export const GOAL_ITERATIONS_TEXT = 'Goal stopped: it used every iteration. Send /goal again to keep going.';
export const GOAL_BUDGET_TEXT = 'Goal stopped: it reached its token budget. Raise ingot.agent.goal.tokenBudget or send /goal again.';
