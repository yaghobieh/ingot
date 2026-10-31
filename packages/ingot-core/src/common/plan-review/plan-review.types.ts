import type { TaskType } from '../router/router.types';

/** IDEA-306 Plan-Diff Review: a plan the user approved (Build) and how the run's diff lines up with its steps. */
export interface ApprovedPlan {
    /** Project-relative file under `.ingot/plans/`. */
    readonly path: string;
    readonly title: string;
    readonly prompt: string;
    readonly taskType: TaskType;
    readonly steps: readonly string[];
    readonly approvedAt: string;
}

export type PlanStepState = 'matched' | 'missing';

export interface PlanStepReview {
    readonly text: string;
    readonly state: PlanStepState;
    /** Files or commands that matched the step. */
    readonly evidence: readonly string[];
}

export interface PlanReview {
    readonly path: string;
    readonly steps: readonly PlanStepReview[];
    /** Changed files no step names or describes. */
    readonly outOfScope: readonly string[];
    readonly matched: number;
    readonly total: number;
}

/** What the run did: files it changed and commands it ran. */
export interface RunDiff {
    readonly files: readonly string[];
    readonly commands: readonly string[];
}
