import 'server-only';
import { PAID_PLANS } from '@/constants/plans.consts';
import type { BillingInfo, PlanId, PublicUser } from '@/types/domain.types';
import { getConfig } from '@server/config/config';
import { query, queryOne } from '@server/db/db';
import { HTTP_STATUS } from '@server/http/http.consts';
import { fail } from '@server/http/http';
import type { BillingProvider, CheckoutResult } from '@server/services/billing/billing.types';
import { LemonSqueezyProvider } from '@server/services/billing/lemon.provider';
import { StubBillingProvider } from '@server/services/billing/stub.provider';
import { setUserPlan } from '@server/services/user.service';

export function billingProvider(): BillingProvider {
    const { billing } = getConfig();
    const lemon = new LemonSqueezyProvider(billing.lemonSqueezy);
    return billing.provider === 'lemonsqueezy' && lemon.isConfigured() ? lemon : new StubBillingProvider();
}

export async function billingInfo(user: PublicUser): Promise<BillingInfo> {
    const provider = billingProvider();
    const sub = await queryOne<{ status: string; renews_at: Date | null }>('SELECT status, renews_at FROM subscriptions WHERE user_id = $1', [user.id]);
    return { plan: user.plan, status: sub?.status ?? 'none', provider: provider.name, configured: provider.isConfigured(), renewsAt: sub?.renews_at?.toISOString() ?? null };
}

export async function startCheckout(user: PublicUser, plan: PlanId): Promise<CheckoutResult> {
    if (!PAID_PLANS.includes(plan)) { fail(HTTP_STATUS.badRequest, 'invalid_plan'); }
    return billingProvider().createCheckout(user, plan, `${getConfig().appUrl}/dashboard/billing?checkout=done`);
}

export async function handleBillingWebhook(rawBody: string, signature: string | null): Promise<void> {
    let change;
    try {
        change = billingProvider().parseWebhook(rawBody, signature);
    } catch {
        return fail(HTTP_STATUS.unauthorized, 'invalid_signature');
    }
    if (!change) { return; }
    await query(
        `INSERT INTO subscriptions (user_id, plan, status, provider, provider_subscription_id, renews_at, updated_at) VALUES ($1, $2, $3, $4, $5, $6, now())
         ON CONFLICT (user_id) DO UPDATE SET plan = EXCLUDED.plan, status = EXCLUDED.status, provider_subscription_id = EXCLUDED.provider_subscription_id, renews_at = EXCLUDED.renews_at, updated_at = now()`,
        [change.userId, change.plan, change.status, billingProvider().name, change.providerSubscriptionId, change.renewsAt]
    );
    await setUserPlan(change.userId, change.plan);
}
