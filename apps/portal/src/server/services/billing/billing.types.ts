import type { PlanId, PublicUser } from '@/types/domain.types';

export type CheckoutResult = { kind: 'redirect'; url: string } | { kind: 'stubbed' };

export interface SubscriptionChange {
    userId: string;
    plan: PlanId;
    status: string;
    providerSubscriptionId: string;
    renewsAt: string | null;
}

/** Any billing backend (Lemon Squeezy today) implements this; the rest of the portal only sees this interface. */
export interface BillingProvider {
    readonly name: string;
    isConfigured(): boolean;
    createCheckout(user: PublicUser, plan: PlanId, redirectUrl: string): Promise<CheckoutResult>;
    /** Verifies the signature and maps the event; returns undefined for events we ignore. */
    parseWebhook(rawBody: string, signature: string | null): SubscriptionChange | undefined;
}
