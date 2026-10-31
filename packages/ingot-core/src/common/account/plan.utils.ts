import type { AccountUser } from './account-protocol';
import { ADMIN_ROLE, OWNER_ACCOUNT_EMAILS, PLAN_SEPARATORS, PRO_PLUS_PLANS } from './plan.consts';

export const normalizePlan = (plan: string | undefined): string =>
    (plan ?? '').trim().toLowerCase().replace(PLAN_SEPARATORS, '');

/** The Zaprex (Rex) app is a PRO+ feature; free, pro and unknown plans never see its entry point. */
export const isProPlusPlan = (plan: string | undefined): boolean => PRO_PLUS_PLANS.includes(normalizePlan(plan));

/** Admins (server role or an owner email) get every paid feature: Pro+ in the plan gate and the admin console. */
export const isAdminUser = (user: Pick<AccountUser, 'email' | 'role'> | undefined): boolean =>
    !!user && (user.role === ADMIN_ROLE || OWNER_ACCOUNT_EMAILS.includes(user.email.trim().toLowerCase()));
