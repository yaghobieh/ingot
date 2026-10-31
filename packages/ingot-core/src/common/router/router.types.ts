/**
 * IDEA-307 Autopilot model router: what kind of task a prompt is, how hard it looks, and where a simple step was sent.
 */
export type TaskType = 'question' | 'explain' | 'docs' | 'rename' | 'format' | 'test' | 'bugfix' | 'refactor' | 'feature' | 'general';
export type TaskComplexity = 'simple' | 'complex';

export interface TaskProfile {
    readonly type: TaskType;
    readonly complexity: TaskComplexity;
}

/** What the classifier looks at besides the prompt. */
export interface TaskSignals {
    readonly mode: string;
    /** `@path` mentions and attached chips. */
    readonly files: number;
}

/** The model fields the origin check reads (catalog or gateway model). */
export interface RoutableModel {
    readonly id: string;
    readonly label: string;
    readonly provider: string;
    readonly model: string;
    readonly contextWindow: number;
    readonly recommended: boolean;
    readonly speed: 'fast' | 'balanced' | 'slow';
}

export interface RouteRequest<M extends RoutableModel = RoutableModel> {
    readonly current: M;
    readonly candidates: readonly M[];
    readonly profile: TaskProfile;
    /** Estimated input tokens of the step; the target must fit them. */
    readonly tokens: number;
    /** Model the user accepted for this task type (learned in Habits), if any. */
    readonly learned?: string;
    /** Blended USD per 1M tokens of a model. */
    readonly priceOf: (model: M) => number;
    /** Connected and runnable right now. */
    readonly configured: (id: string) => boolean;
    /** Provider-side name overrides (Settings › Models), checked by the origin filter too. */
    readonly overrideOf?: (model: M) => string | undefined;
}

export interface RouteDecision {
    readonly from: string;
    readonly to: string;
    readonly taskType: TaskType;
    /** True when the target came from a model the user accepted before for this task type. */
    readonly learned: boolean;
    /** Share of the price saved per token (0..1). */
    readonly saving: number;
}
