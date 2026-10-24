import type { PlanDefinition, PlanId } from '@/types/domain.types';

/**
 * Pricing placeholders for 0.1.0. Prices are NOT decided: every paid plan is `priceStatus: 'tbd'`
 * and renders as "TBD" until the owner sets a final number here.
 */
export const PLANS: PlanDefinition[] = [
    { id: 'free', monthlyPriceUsd: 0, priceStatus: 'final', featureKeys: ['byok', 'allModels', 'agents', 'plugins', 'community'], highlighted: false },
    { id: 'pro', monthlyPriceUsd: null, priceStatus: 'tbd', featureKeys: ['everythingFree', 'hostedModels', 'autocomplete', 'sync', 'priority'], highlighted: true },
    { id: 'team', monthlyPriceUsd: null, priceStatus: 'tbd', featureKeys: ['everythingPro', 'seats', 'roles', 'sharedRules', 'adminUsage'], highlighted: false }
];

export const PAID_PLANS: PlanId[] = ['pro', 'team'];
export const DEFAULT_PLAN: PlanId = 'free';
