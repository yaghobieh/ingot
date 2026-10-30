export type GoalState = 'running' | 'done' | 'stopped';
export type GoalStopReason = 'iterations' | 'budget' | 'user' | 'error';
export type GoalVerdict = 'done' | 'continue';

export interface GoalCriterion {
    readonly text: string;
    readonly met: boolean;
}

/** IDEA-292: a `/goal` run on a chat. The loop continues until the self-check proves every criterion. */
export interface AgentGoal {
    readonly objective: string;
    readonly criteria: readonly GoalCriterion[];
    /** Finished agent turns (one model loop each). */
    readonly iteration: number;
    readonly maxIterations: number;
    /** Estimated tokens (prompt + reply) the goal may spend. */
    readonly tokenBudget: number;
    readonly tokensUsed: number;
    readonly state: GoalState;
    readonly reason?: GoalStopReason;
    readonly startedAt: number;
}

/** The `GOAL CHECK` block at the end of a reply. */
export interface GoalCheck {
    readonly criteria: readonly GoalCriterion[];
    readonly verdict?: GoalVerdict;
}

export interface GoalCommand {
    readonly objective: string;
    readonly criteria: readonly string[];
}

export interface GoalLimits {
    readonly maxIterations: number;
    readonly tokenBudget: number;
}

export type GoalDecision =
    | { readonly kind: 'done' }
    | { readonly kind: 'continue'; readonly nudge: string }
    | { readonly kind: 'stop'; readonly reason: GoalStopReason; readonly message: string };
