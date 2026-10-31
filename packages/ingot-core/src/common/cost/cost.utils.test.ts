import { describe, expect, it } from 'vitest';
import { MODEL_CATALOG } from '../models/models.consts';
import { toCatalogModel } from '../account/gateway.utils';
import { approxUsd, blendedPrice, estimateRunCost, formatPrice, formatUsd, isOverBudget, priceOf, showsForecast } from './cost.utils';

const byId = (id: string) => MODEL_CATALOG.find(m => m.id === id)!;

describe('IDEA-307 cost forecast', () => {
    it('prices catalog models from the table, gateway models by tier and local models as free', () => {
        expect(priceOf(byId('claude-sonnet-4-5'))).toEqual({ input: 3, output: 15 });
        expect(priceOf(byId('ollama-local'))).toEqual({ input: 0, output: 0 });
        expect(priceOf(toCatalogModel({ id: 'ingot-fast', label: 'Fast', contextWindow: 1 }))).toEqual({ input: 0.25, output: 1.25 });
        expect(priceOf(toCatalogModel({ id: 'ingot-reasoning', label: 'Reasoning', contextWindow: 1 }))).toEqual({ input: 15, output: 75 });
        expect(priceOf(toCatalogModel({ id: 'ingot-mock', label: 'Mock', contextWindow: 1 }))).toEqual({ input: 3, output: 15 });
        expect(priceOf({ id: 'x', provider: 'openai', model: 'x', cost: '$$$' })).toEqual({ input: 15, output: 75 });
    });

    it('every catalog model has a price', () => {
        for (const m of MODEL_CATALOG) {
            expect(Number.isFinite(blendedPrice(priceOf(m))), m.id).toBe(true);
        }
    });

    it('estimates tokens and USD over the rounds a mode takes', () => {
        const ask = estimateRunCost({ systemTokens: 3000, historyTokens: 0, promptTokens: 1000, mode: 'ask', price: { input: 3, output: 15 } });
        expect(ask).toEqual({ inputTokens: 4000, outputTokens: 700, usd: (4000 * 3 + 700 * 15) / 1_000_000 });
        const agent = estimateRunCost({ systemTokens: 3000, historyTokens: 0, promptTokens: 1000, mode: 'agent', price: { input: 3, output: 15 } });
        expect(agent.inputTokens).toBe(4000 * 3 + 1500 + 3000);
        expect(agent.outputTokens).toBe(4500);
        expect(estimateRunCost({ systemTokens: 1, historyTokens: 1, promptTokens: 1, mode: 'agent', price: { input: 0, output: 0 } }).usd).toBe(0);
    });

    it('formats amounts for the composer', () => {
        expect(formatUsd(0)).toBe('$0');
        expect(formatUsd(0.004)).toBe('$0.004');
        expect(formatUsd(0.0004)).toBe('<$0.001');
        expect(approxUsd(0.0412)).toBe('~$0.04');
        expect(approxUsd(0.0004)).toBe('<$0.001');
        expect(formatUsd(0.0412)).toBe('$0.04');
        expect(formatUsd(12.4)).toBe('$12');
        expect(formatPrice({ input: 0, output: 0 })).toBe('free');
        expect(formatPrice({ input: 3, output: 15 })).toBe('$3 in / $15 out per 1M tokens');
    });

    it('warns only over a positive threshold', () => {
        expect(isOverBudget(0.6, 0.5)).toBe(true);
        expect(isOverBudget(0.5, 0.5)).toBe(false);
        expect(isOverBudget(100, 0)).toBe(false);
    });

    it('hides the composer estimate for a free run unless it was routed or is over the warning', () => {
        const estimate = (usd: number) => ({ inputTokens: 100, outputTokens: 50, usd });
        expect(showsForecast({ estimate: estimate(0), over: false })).toBe(false);
        expect(showsForecast({ estimate: estimate(0.02), over: false })).toBe(true);
        expect(showsForecast({ estimate: estimate(0), over: true })).toBe(true);
        expect(showsForecast({ estimate: estimate(0), over: false, routed: { from: 'a', to: 'b', taskType: 'rename', learned: false, saving: 0.5 } })).toBe(true);
    });
});
