import type { GatedFeature, PlanTier } from './plan.types';

/** Lowest first; a tier includes everything below it. */
export const PLAN_TIERS: readonly PlanTier[] = ['free', 'pro', 'proplus'];

/** Signed out, blocked or an unknown plan id. */
export const DEFAULT_PLAN_TIER: PlanTier = 'free';

/** Account plan ids (portal / ingot-server `PlanId`, normalized by `normalizePlanId`) to the tier the IDE gates on. */
export const ACCOUNT_PLAN_TIERS: Readonly<Record<string, PlanTier>> = {
    free: 'free',
    pro: 'pro',
    team: 'pro',
    pro_plus: 'proplus',
    proplus: 'proplus',
    ultra: 'proplus'
};

export const FEATURE_TIERS: Readonly<Record<GatedFeature, PlanTier>> = {
    agent: 'pro',
    chat: 'pro',
    inlineCompletions: 'pro',
    rex: 'proplus',
    multiAgent: 'proplus'
};

export const PLAN_TIER_LABELS: Readonly<Record<PlanTier, string>> = {
    free: 'Free',
    pro: 'Pro',
    proplus: 'Pro+'
};

export const GATED_FEATURE_LABELS: Readonly<Record<GatedFeature, string>> = {
    agent: 'The AI agent',
    chat: 'AI chat',
    inlineCompletions: 'AI autocomplete',
    rex: 'Rex (Zaprex)',
    multiAgent: 'Multiple agents'
};
