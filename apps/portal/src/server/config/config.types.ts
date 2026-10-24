export type EmailProviderName = 'outbox' | 'resend';
export type BillingProviderName = 'stub' | 'lemonsqueezy';

export interface OAuthClientConfig {
    clientId: string;
    clientSecret: string;
}

export interface PortalConfig {
    appUrl: string;
    database: { url: string; testUrl: string };
    security: { encryptionKey: string };
    email: { provider: EmailProviderName; from: string; resendApiKey: string };
    oauth: { github: OAuthClientConfig; google: OAuthClientConfig };
    billing: {
        provider: BillingProviderName;
        lemonSqueezy: { apiKey: string; storeId: string; webhookSecret: string; variants: { pro: string; team: string } };
    };
    features: { devOutbox: boolean; sampleData: boolean };
}
