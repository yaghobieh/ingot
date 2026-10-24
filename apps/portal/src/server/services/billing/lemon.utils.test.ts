import { describe, expect, it } from 'vitest';
import { mapLemonEvent, verifyLemonSignature } from '@server/services/billing/lemon.utils';
import { hmacSha256Hex } from '@server/utils/crypto.utils';

const config = { apiKey: '', storeId: '1', webhookSecret: 'test-secret', variants: { pro: '11', team: '22' } };

describe('lemon squeezy webhook', () => {
    it('verifies the HMAC signature', () => {
        const body = '{"a":1}';
        expect(verifyLemonSignature(body, hmacSha256Hex(body, 'test-secret'), 'test-secret')).toBe(true);
        expect(verifyLemonSignature(body, 'deadbeef', 'test-secret')).toBe(false);
        expect(verifyLemonSignature(body, null, 'test-secret')).toBe(false);
        expect(verifyLemonSignature(body, hmacSha256Hex(body, ''), '')).toBe(false);
    });
    it('maps subscription events to plans', () => {
        const base = { meta: { event_name: 'subscription_created', custom_data: { user_id: 'u1' } }, data: { id: '9', attributes: { status: 'active', variant_id: 22, renews_at: null } } };
        expect(mapLemonEvent(base, config)).toMatchObject({ userId: 'u1', plan: 'team', status: 'active' });
        expect(mapLemonEvent({ ...base, data: { id: '9', attributes: { status: 'expired', variant_id: 11 } } }, config)?.plan).toBe('free');
        expect(mapLemonEvent({ ...base, meta: { event_name: 'order_created', custom_data: { user_id: 'u1' } } }, config)).toBeUndefined();
    });
});
