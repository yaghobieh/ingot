import 'server-only';
import type { BillingProvider, CheckoutResult, SubscriptionChange } from '@server/services/billing/billing.types';

/** Used until Lemon Squeezy keys exist: no checkout, webhooks rejected. */
export class StubBillingProvider implements BillingProvider {
    readonly name = 'stub';

    isConfigured(): boolean {
        return false;
    }

    async createCheckout(): Promise<CheckoutResult> {
        return { kind: 'stubbed' };
    }

    parseWebhook(): SubscriptionChange | undefined {
        throw new Error('billing_not_configured');
    }
}
