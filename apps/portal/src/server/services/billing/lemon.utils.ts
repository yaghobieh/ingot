import type { LemonSqueezyConfig } from '@server/services/billing/lemon.types';
import { LEMON_ACTIVE_STATUSES, LEMON_SUBSCRIPTION_EVENTS } from '@server/services/billing/billing.consts';
import type { SubscriptionChange } from '@server/services/billing/billing.types';
import { hmacSha256Hex, safeEqual } from '@server/utils/crypto.utils';

interface LemonWebhookBody {
    meta?: { event_name?: string; custom_data?: { user_id?: string } };
    data?: { id?: string; attributes?: { status?: string; renews_at?: string | null; variant_id?: number | string } };
}

export function verifyLemonSignature(rawBody: string, signature: string | null, secret: string): boolean {
    return Boolean(signature && secret) && safeEqual(hmacSha256Hex(rawBody, secret), signature ?? '');
}

/** Maps a verified Lemon Squeezy subscription webhook to a plan change. */
export function mapLemonEvent(body: LemonWebhookBody, config: LemonSqueezyConfig): SubscriptionChange | undefined {
    const event = body.meta?.event_name ?? '';
    const userId = body.meta?.custom_data?.user_id;
    const attributes = body.data?.attributes;
    if (!LEMON_SUBSCRIPTION_EVENTS.includes(event) || !userId || !attributes) { return undefined; }
    const variant = String(attributes.variant_id ?? '');
    const paidPlan = variant && variant === config.variants.team ? 'team' : 'pro';
    const status = attributes.status ?? 'unknown';
    return {
        userId,
        plan: LEMON_ACTIVE_STATUSES.includes(status) ? paidPlan : 'free',
        status,
        providerSubscriptionId: String(body.data?.id ?? ''),
        renewsAt: attributes.renews_at ?? null
    };
}
