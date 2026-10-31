import {
    CHEAPER_RATIO, CHINESE_ORIGIN_PATTERNS, CHINESE_ORIGIN_PROVIDERS, COMPLEX_MODES, CONTEXT_HEADROOM, SIMPLE_MAX_FILES, SIMPLE_MAX_WORDS,
    SIMPLE_TASK_TYPES, TASK_PATTERNS, TASK_TYPE_LABELS, UNKNOWN_UPSTREAM_PATTERNS
} from './router.consts';
import type { RoutableModel, RouteDecision, RouteRequest, TaskProfile, TaskSignals, TaskType } from './router.types';

const SPEED_RANK = { fast: 0, balanced: 1, slow: 2 } as const;

/** The kind of task a prompt asks for (first matching pattern; `general` otherwise). */
export const classifyTask = (prompt: string): TaskType => {
    const text = prompt.trim();
    return TASK_PATTERNS.find(p => p.test.test(text))?.type ?? 'general';
};

/** Short prompts of a simple kind, with few files and outside Plan / Multi / Debug, are simple steps. */
export const profileTask = (prompt: string, signals: TaskSignals): TaskProfile => {
    const type = classifyTask(prompt);
    const words = prompt.trim().split(/\s+/).filter(Boolean).length;
    const simple = SIMPLE_TASK_TYPES.has(type) && words <= SIMPLE_MAX_WORDS && signals.files <= SIMPLE_MAX_FILES && !COMPLEX_MODES.has(signals.mode);
    return { type, complexity: simple ? 'simple' : 'complex' };
};

export const taskTypeLabel = (type: TaskType): string => TASK_TYPE_LABELS[type];

/** True for DeepSeek, Qwen, Kimi / Moonshot, GLM / Zhipu, MiniMax, Baichuan, Yi and the other Chinese-origin families. */
export const isChineseOriginModel = (model: Pick<RoutableModel, 'id' | 'label' | 'provider' | 'model'>, override?: string): boolean =>
    CHINESE_ORIGIN_PROVIDERS.has(model.provider.toLowerCase())
    || [model.id, model.label, model.model, override ?? ''].some(text => text && CHINESE_ORIGIN_PATTERNS.some(re => re.test(text)));

/** Routers of routers (OpenRouter auto, Auto): their upstream is chosen elsewhere and may be any model. */
export const hasUnknownUpstream = (model: Pick<RoutableModel, 'id' | 'model'>): boolean =>
    [model.id, model.model].some(text => UNKNOWN_UPSTREAM_PATTERNS.some(re => re.test(text)));

/** A model the router may send a step to. */
export const isRouterSafe = (model: RoutableModel, override?: string): boolean => !isChineseOriginModel(model, override) && !hasUnknownUpstream(model);

/**
 * Where a simple step goes: the model the user accepted for this task type (when it is safe, runnable and not dearer),
 * else the cheapest safe runnable model that costs at most CHEAPER_RATIO of the current one and fits the step.
 * Undefined keeps the step on the current model. Chinese-origin and unknown-upstream models are never picked.
 */
export const pickRoute = <M extends RoutableModel>(request: RouteRequest<M>): RouteDecision | undefined => {
    const { current, profile, priceOf, configured, overrideOf } = request;
    if (profile.complexity !== 'simple') {
        return undefined;
    }
    const currentPrice = priceOf(current);
    const fits = (m: M): boolean => m.contextWindow >= request.tokens * CONTEXT_HEADROOM;
    const eligible = request.candidates.filter(m => m.id !== current.id && configured(m.id) && isRouterSafe(m, overrideOf?.(m)) && fits(m));
    const decision = (target: M, learned: boolean): RouteDecision => ({
        from: current.id, to: target.id, taskType: profile.type, learned,
        saving: currentPrice > 0 ? Math.max(0, 1 - priceOf(target) / currentPrice) : 0
    });
    const learned = request.learned ? eligible.find(m => m.id === request.learned) : undefined;
    if (learned && priceOf(learned) <= currentPrice) {
        return decision(learned, true);
    }
    const cheaper = eligible.filter(m => priceOf(m) <= currentPrice * CHEAPER_RATIO && priceOf(m) < currentPrice)
        .sort((a, b) => priceOf(a) - priceOf(b) || Number(b.recommended) - Number(a.recommended) || SPEED_RANK[a.speed] - SPEED_RANK[b.speed]);
    return cheaper.length ? decision(cheaper[0], false) : undefined;
};
