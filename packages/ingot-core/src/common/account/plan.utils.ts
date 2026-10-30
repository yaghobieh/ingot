import { PLAN_SEPARATORS, PRO_PLUS_PLANS } from './plan.consts';

export const normalizePlan = (plan: string | undefined): string =>
    (plan ?? '').trim().toLowerCase().replace(PLAN_SEPARATORS, '');

/** The Zaprex (Rex) app is a PRO+ feature; free, pro and unknown plans never see its entry point. */
export const isProPlusPlan = (plan: string | undefined): boolean => PRO_PLUS_PLANS.includes(normalizePlan(plan));
