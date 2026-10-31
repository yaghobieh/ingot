import type { TaskType } from '../router/router.types';

/**
 * IDEA-305/306/307: preferences Habits learns from what the user accepts: when a chat has gone stale (turns), how plans
 * for a task type are shaped, and which model the user keeps for a task type.
 */
export type LearnedKind = 'handoff-turns' | 'plan-template' | 'model-choice';
export type LearnedStatus = 'learning' | 'saved';

export interface LearnedSample {
    /** Turn count, model id or generalized plan steps (one per line). */
    readonly value: string;
    /** Accepted (true) or turned down (false). */
    readonly positive: boolean;
    readonly at: number;
}

export interface LearnedHabit {
    /** `handoff-turns`, `plan-template:bugfix`, `model-choice:explain`. */
    readonly id: string;
    readonly kind: LearnedKind;
    readonly taskType?: TaskType;
    readonly samples: readonly LearnedSample[];
    readonly status: LearnedStatus;
    /** Off: neither counted nor applied. */
    readonly enabled: boolean;
    /** What is applied once saved: the turn threshold, the model id or the plan template. */
    readonly value?: string;
    /** File written for it (plan templates). */
    readonly savedAs?: string;
    readonly firstSeen: number;
    readonly lastSeen: number;
}

export interface LearnedFile {
    readonly version: number;
    readonly learned: readonly LearnedHabit[];
}

export interface LearnedEvidence {
    readonly kind: LearnedKind;
    readonly taskType?: TaskType;
    readonly value: string;
    readonly positive: boolean;
}

export interface LearnOutcome {
    readonly learned: LearnedHabit[];
    /** Set when this evidence saved the habit (first time it reached the threshold). */
    readonly saved?: LearnedHabit;
}
