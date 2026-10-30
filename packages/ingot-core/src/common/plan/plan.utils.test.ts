import { describe, expect, it } from 'vitest';
import { isEntitled, planTierOf } from './plan.utils';

const signedIn = (plan: string) => ({ signedIn: true, user: { name: 'Test User', email: 'test@ingot.dev', plan } });

describe('plan gate', () => {
    it('maps account plans to tiers and gates AI features by tier', () => {
        expect(planTierOf({ signedIn: false })).toBe('free');
        expect(planTierOf({ ...signedIn('pro'), blocked: true })).toBe('free');
        expect(planTierOf(signedIn('something_new'))).toBe('free');
        expect(planTierOf(signedIn('team'))).toBe('pro');
        expect(planTierOf(signedIn('Pro+'))).toBe('proplus');
        expect(planTierOf(signedIn('ultra'))).toBe('proplus');

        expect(isEntitled('free', 'chat')).toBe(false);
        expect(isEntitled('free', 'agent')).toBe(false);
        expect(isEntitled('pro', 'chat')).toBe(true);
        expect(isEntitled('pro', 'rex')).toBe(false);
        expect(isEntitled('proplus', 'rex')).toBe(true);
        expect(isEntitled('proplus', 'multiAgent')).toBe(true);
    });
});
