import { describe, expect, it } from 'vitest';
import { devLoginUrl, gatewayModelName, ingotModelId, isIngotModel, isLoopbackUrl, parseGatewayModels, snapshotOf, toCatalogModel, tokensLeftLabel, usedRatio } from './gateway.utils';
import type { IdeStatusResponse } from './shared/ide-auth.types';

describe('Ingot gateway in the IDE (IDEA-101)', () => {
    it('maps /v1/models rows to picker models under the ingot provider', () => {
        const models = parseGatewayModels({ data: [{ id: 'ingot-fast', name: 'Ingot Fast', context_window: 128000, available: true }, { id: 'x', available: false }, { bad: 1 }] });
        expect(models).toEqual([{ id: 'ingot-fast', label: 'Ingot Fast', contextWindow: 128000, available: true }, { id: 'x', label: 'x', contextWindow: 128000, available: false }]);
        const entry = toCatalogModel(models[0]);
        expect(entry).toMatchObject({ id: 'ingot:ingot-fast', provider: 'ingot', model: 'ingot-fast', speed: 'fast', recommended: true });
        expect(isIngotModel(entry.id)).toBe(true);
        expect(gatewayModelName(ingotModelId('gpt-4.1'))).toBe('gpt-4.1');
        expect(parseGatewayModels(undefined)).toEqual([]);
    });

    it('builds the account snapshot and token labels from /api/ide/status', () => {
        const status = {
            user: { id: 'u', email: 'test@ingot.dev', name: 'Test User', avatarUrl: '', plan: 'pro' },
            balance: { plan: 'pro', period: { start: '', end: '' }, tokens: { allowance: 2_000_000, granted: 500_000, used: 1_250_000, remaining: 1_250_000 }, spend: { budgetUsd: null, usedUsd: 0, remainingUsd: null }, byModel: [] },
            activity: []
        } satisfies IdeStatusResponse;
        const snap = snapshotOf(status, 5);
        expect(snap).toEqual({ signedIn: true, user: { name: 'Test User', email: 'test@ingot.dev', plan: 'pro', avatarUrl: undefined }, tokens: { used: 1_250_000, remaining: 1_250_000, allowance: 2_500_000 }, updatedAt: 5 });
        expect(tokensLeftLabel(snap.tokens!)).toBe('1.2M left');
        expect(tokensLeftLabel({ used: 0, remaining: 4200, allowance: 1 })).toBe('4k left');
        expect(usedRatio(snap.tokens!)).toBe(0.5);
    });

    it('dev login only for loopback servers, landing on the authorize page', () => {
        expect(isLoopbackUrl('http://127.0.0.1:3300')).toBe(true);
        expect(isLoopbackUrl('https://ingot.dev')).toBe(false);
        const url = new URL(devLoginUrl('http://localhost:3200/', 'test@ingot.dev', '/ide/authorize?state=s'));
        expect(url.pathname).toBe('/api/dev/login');
        expect(url.searchParams.get('next')).toBe('/ide/authorize?state=s');
        expect(url.searchParams.get('email')).toBe('test@ingot.dev');
    });
});
