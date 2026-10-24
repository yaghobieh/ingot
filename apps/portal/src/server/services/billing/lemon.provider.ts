import 'server-only';
import type { PlanId, PublicUser } from '@/types/domain.types';
import { LEMON_API_BASE, LEMON_CONTENT_TYPE } from '@server/services/billing/billing.consts';
import type { BillingProvider, CheckoutResult, SubscriptionChange } from '@server/services/billing/billing.types';
import type { LemonSqueezyConfig } from '@server/services/billing/lemon.types';
import { mapLemonEvent, verifyLemonSignature } from '@server/services/billing/lemon.utils';

export class LemonSqueezyProvider implements BillingProvider {
    readonly name = 'lemonsqueezy';

    constructor(private readonly config: LemonSqueezyConfig) {}

    isConfigured(): boolean {
        const { apiKey, storeId, webhookSecret, variants } = this.config;
        return Boolean(apiKey && storeId && webhookSecret && variants.pro && variants.team);
    }

    async createCheckout(user: PublicUser, plan: PlanId, redirectUrl: string): Promise<CheckoutResult> {
        const variant = plan === 'team' ? this.config.variants.team : this.config.variants.pro;
        const response = await fetch(`${LEMON_API_BASE}/checkouts`, {
            method: 'POST',
            headers: { Authorization: `Bearer ${this.config.apiKey}`, Accept: LEMON_CONTENT_TYPE, 'Content-Type': LEMON_CONTENT_TYPE },
            body: JSON.stringify({
                data: {
                    type: 'checkouts',
                    attributes: { checkout_data: { email: user.email, name: user.name, custom: { user_id: user.id } }, product_options: { redirect_url: redirectUrl } },
                    relationships: {
                        store: { data: { type: 'stores', id: this.config.storeId } },
                        variant: { data: { type: 'variants', id: variant } }
                    }
                }
            })
        });
        const body = await response.json() as { data?: { attributes?: { url?: string } } };
        const url = body.data?.attributes?.url;
        if (!response.ok || !url) { throw new Error(`checkout failed with status ${response.status}`); }
        return { kind: 'redirect', url };
    }

    parseWebhook(rawBody: string, signature: string | null): SubscriptionChange | undefined {
        if (!verifyLemonSignature(rawBody, signature, this.config.webhookSecret)) { throw new Error('invalid_signature'); }
        return mapLemonEvent(JSON.parse(rawBody), this.config);
    }
}
