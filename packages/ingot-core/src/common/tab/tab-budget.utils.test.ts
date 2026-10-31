import { describe, expect, it } from 'vitest';
import { addUsage, budgetBlock, estimateTokens, tabDay, usageForDay } from './tab-budget.utils';

const LIMITS = { maxRequestsPerDay: 2, maxTokensPerDay: 100 };

describe('Tab daily budget (IDEA-285)', () => {
    it('keys usage by local day and resets on a new day', () => {
        expect(tabDay(new Date(2026, 0, 5, 23, 59))).toBe('2026-01-05');
        const stored = { day: '2026-01-05', requests: 7, tokens: 900 };
        expect(usageForDay(stored, '2026-01-05')).toBe(stored);
        expect(usageForDay(stored, '2026-01-06')).toEqual({ day: '2026-01-06', requests: 0, tokens: 0 });
        expect(usageForDay(undefined, '2026-01-06')).toEqual({ day: '2026-01-06', requests: 0, tokens: 0 });
    });

    it('blocks at the request cap', () => {
        let usage = usageForDay(undefined, 'd');
        expect(budgetBlock(usage, LIMITS, 10)).toBeUndefined();
        usage = addUsage(addUsage(usage, 10), 10);
        expect(usage).toEqual({ day: 'd', requests: 2, tokens: 20 });
        expect(budgetBlock(usage, LIMITS, 10)).toBe('requests');
    });

    it('blocks a request that would go over the token budget', () => {
        const usage = { day: 'd', requests: 0, tokens: 95 };
        expect(budgetBlock(usage, LIMITS, 5)).toBeUndefined();
        expect(budgetBlock(usage, LIMITS, 6)).toBe('tokens');
    });

    it('treats a cap of zero as "no requests"', () => {
        expect(budgetBlock(usageForDay(undefined, 'd'), { maxRequestsPerDay: 0, maxTokensPerDay: 100 }, 1)).toBe('requests');
    });

    it('estimates tokens from characters', () => {
        expect(estimateTokens('')).toBe(0);
        expect(estimateTokens('abcde')).toBe(2);
    });
});
