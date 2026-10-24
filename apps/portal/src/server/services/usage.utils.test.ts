import { describe, expect, it } from 'vitest';
import { fillDays, normalizeUsageEvent, sampleUsageEvents, usageToCsv } from '@server/services/usage.utils';

describe('usage utils', () => {
    it('normalizes and clamps an IDE usage event', () => {
        const event = normalizeUsageEvent({ model: 'gpt-5', requests: -3, inputTokens: 1e12, outputTokens: 12.7, costUsd: 0.25 });
        expect(event).toMatchObject({ model: 'gpt-5', feature: 'agent', requests: 1, inputTokens: 10_000_000, outputTokens: 12, costMicros: 250_000 });
    });
    it('rejects events without a model or with a bad date', () => {
        expect(normalizeUsageEvent({ model: '' })).toBeUndefined();
        expect(normalizeUsageEvent({ model: 'x', occurredAt: 'nope' })).toBeUndefined();
    });
    it('fills missing days with zeros, oldest first', () => {
        const filled = fillDays([{ day: '2026-10-23', requests: 2, inputTokens: 1, outputTokens: 1, costUsd: 1 }], 3, new Date('2026-10-24T10:00:00Z'));
        expect(filled.map(d => d.day)).toEqual(['2026-10-22', '2026-10-23', '2026-10-24']);
        expect(filled[1].requests).toBe(2);
        expect(filled[0].requests).toBe(0);
    });
    it('escapes CSV cells including formula injection', () => {
        const csv = usageToCsv([{ id: '1', model: '=cmd', feature: 'a,b', occurredAt: 't', requests: 1, inputTokens: 2, outputTokens: 3, costUsd: 0.5 }]);
        expect(csv.split('\n')[1]).toBe('t,"=cmd","a,b",1,2,3,0.500000');
    });
    it('generates 30 days of sample usage', () => {
        const events = sampleUsageEvents(new Date('2026-10-24T00:00:00Z'), () => 0.5);
        expect(events.length).toBeGreaterThan(30);
        expect(events.every(e => normalizeUsageEvent(e))).toBe(true);
    });
});
