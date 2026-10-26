import { describe, expect, it } from 'vitest';
import { billingUrl, chatErrorText, countdownLabel, upgradePromptText, decodeGatewayError, rateLimitText, encodeGatewayError, fallsBackToDefault, parseGatewayError, refetchesModels, retryAfterSeconds } from './gateway-errors';

describe('gateway errors', () => {
    it('parses rate limits with Retry-After', () => {
        const e = parseGatewayError(429, { error: { code: 'rate_limited', message: 'Slow down', scope: 'user', retry_after_seconds: 30 } }, '12');
        expect(e).toMatchObject({ kind: 'rate_limited', message: 'Slow down', retryAfterSeconds: 12, scope: 'user' });
        expect(parseGatewayError(429, { error: { code: 'rate_limited' } })?.retryAfterSeconds).toBe(60);
        expect(parseGatewayError(429, { error: { code: 'rate_limited', retry_after_seconds: 4.2 } })?.retryAfterSeconds).toBe(5);
    });

    it('reads HTTP-date Retry-After and clamps', () => {
        expect(retryAfterSeconds(new Date(10_000).toUTCString(), undefined, 0)).toBe(10);
        expect(retryAfterSeconds('99999', undefined)).toBe(3600);
        expect(retryAfterSeconds(undefined, undefined)).toBeUndefined();
    });

    it('maps codes to kinds with fallback text', () => {
        expect(parseGatewayError(402, { error: { code: 'spend_cap_reached', scope: 'plan' } })).toMatchObject({ kind: 'allowance', scope: 'plan' });
        expect(parseGatewayError(503, { error: { code: 'model_disabled', reason: 'maintenance' } })).toMatchObject({ kind: 'model_disabled', reason: 'maintenance' });
        expect(parseGatewayError(403, { error: 'account_blocked' })?.kind).toBe('blocked');
        expect(parseGatewayError(500, { error: { code: 'weird' } })?.kind).toBe('other');
        expect(parseGatewayError(500, { message: 'x' })).toBeUndefined();
    });

    it('round-trips through an error message', () => {
        const e = parseGatewayError(404, { error: { code: 'model_not_found' } })!;
        expect(decodeGatewayError(`Error: ${encodeGatewayError(e)}`)).toEqual(e);
        expect(decodeGatewayError('plain failure')).toBeUndefined();
        expect(refetchesModels(e) && fallsBackToDefault(e)).toBe(true);
    });

    it('formats countdowns', () => {
        expect(countdownLabel(65)).toBe('1:05');
        expect(countdownLabel(0)).toBe('0:00');
    });
});

describe('chat error text', () => {
    const portalUrl = 'http://localhost:3200/';
    it('links billing for allowance errors and names the fallback', () => {
        const allowance = parseGatewayError(402, { error: { code: 'token_cap_reached', message: 'Cap reached.', scope: 'plan' } })!;
        expect(chatErrorText(allowance, { portalUrl })).toBe('Cap reached. Upgrade or top up: http://localhost:3200/dashboard/billing (usage: http://localhost:3200/dashboard/usage).');
        expect(billingUrl(`${portalUrl}/`)).toBe('http://localhost:3200/dashboard/billing');
        expect(upgradePromptText(allowance)).toContain('Upgrade your plan or top up');
        expect(parseGatewayError(503, { error: { code: 'hosted_models_paused' } })?.kind).toBe('model_unavailable');
        const disabled = parseGatewayError(503, { error: { code: 'model_disabled', message: 'Turned off.' } })!;
        expect(chatErrorText(disabled, { portalUrl, fallback: 'Ingot Fast' })).toBe('Turned off. Switched to Ingot Fast; send your message again.');
        const limited = parseGatewayError(429, { error: { code: 'rate_limited', message: 'Slow down.' } }, '65')!;
        expect(rateLimitText(limited, 65)).toBe('Slow down. Retrying in 1:05…');
    });
});
