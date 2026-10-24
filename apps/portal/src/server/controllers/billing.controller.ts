import 'server-only';
import type { PlanId } from '@/types/domain.types';
import { authed } from '@server/http/auth';
import { handle, json, readJson } from '@server/http/http';
import { LEMON_SIGNATURE_HEADER } from '@server/services/billing/billing.consts';
import { billingInfo, handleBillingWebhook, startCheckout } from '@server/services/billing/billing.service';

export const getBilling = authed(async (_request, user) => json(await billingInfo(user)));

export const checkout = authed(async (request, user) => {
    const body = await readJson<{ plan?: PlanId }>(request);
    return json(await startCheckout(user, body.plan ?? 'pro'));
});

/** POST /api/billing/webhook: Lemon Squeezy subscription events, HMAC-verified. */
export const webhook = handle(async request => {
    await handleBillingWebhook(await request.text(), request.headers.get(LEMON_SIGNATURE_HEADER));
    return json({ received: true });
});
