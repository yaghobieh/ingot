import type { PortalConfig } from '@server/config/config.types';

export const CONFIG_FILE_NAME = 'ingot.config.json';
export const CONFIG_PATH_ENV = 'INGOT_CONFIG';
export const DATABASE_URL_ENV = 'INGOT_DATABASE_URL';

export const DEFAULT_CONFIG: PortalConfig = {
    appUrl: 'http://localhost:3200',
    database: { url: '', testUrl: '' },
    security: { encryptionKey: '' },
    email: { provider: 'outbox', from: 'Ingot <no-reply@example.com>', resendApiKey: '' },
    oauth: { github: { clientId: '', clientSecret: '' }, google: { clientId: '', clientSecret: '' } },
    billing: { provider: 'stub', lemonSqueezy: { apiKey: '', storeId: '', webhookSecret: '', variants: { pro: '', team: '' } } },
    features: { devOutbox: false, sampleData: false }
};
