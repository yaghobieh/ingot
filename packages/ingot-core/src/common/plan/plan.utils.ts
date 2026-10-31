import type { AccountSnapshot } from '../account/account-protocol';
import { isAdminUser } from '../account/plan.utils';
import { ACCOUNT_PLAN_TIERS, DEFAULT_PLAN_TIER, FEATURE_TIERS, PLAN_TIERS } from './plan.consts';
import type { GatedFeature, PlanTier } from './plan.types';

/** `Pro+`, `pro-plus`, `Pro Plus` and `pro_plus` all become `pro_plus`. */
export function normalizePlanId(plan: string): string {
    return plan.trim().toLowerCase().replace(/\+/g, '_plus').replace(/[\s-]+/g, '_');
}

/** The tier from the account snapshot: free when signed out, blocked or on a plan the IDE does not know; admins get the top tier. */
export function planTierOf(snapshot: Pick<AccountSnapshot, 'signedIn' | 'user' | 'blocked'>): PlanTier {
    if (!snapshot.signedIn || snapshot.blocked) {
        return DEFAULT_PLAN_TIER;
    }
    if (isAdminUser(snapshot.user)) {
        return PLAN_TIERS[PLAN_TIERS.length - 1];
    }
    if (!snapshot.user?.plan) {
        return DEFAULT_PLAN_TIER;
    }
    return ACCOUNT_PLAN_TIERS[normalizePlanId(snapshot.user.plan)] ?? DEFAULT_PLAN_TIER;
}

export function isEntitled(tier: PlanTier, feature: GatedFeature): boolean {
    return PLAN_TIERS.indexOf(tier) >= PLAN_TIERS.indexOf(FEATURE_TIERS[feature]);
}
