import type { CatalogModel } from '../models/models.types';
import {
    COST_BADGE_PRICES, DEFAULT_OUTPUT_TOKENS, DEFAULT_ROUNDS, GATEWAY_DEFAULT_PRICE, GATEWAY_PRICE_TIERS, MIN_SHOWN_USD, MIN_SMALL_USD, MODE_OUTPUT_TOKENS, MODE_ROUNDS,
    MODEL_PRICES, SMALL_USD_DIGITS, TOKENS_PER_MILLION, WHOLE_DOLLARS_FROM
} from './cost.consts';
import type { CostEstimate, CostForecast, CostInput, ModelPrice } from './cost.types';

/** USD per 1M tokens: the price table, the gateway tier for Ingot models, else the picker's cost badge. */
export const priceOf = (model: Pick<CatalogModel, 'id' | 'provider' | 'model' | 'cost'>): ModelPrice => {
    const listed = MODEL_PRICES[model.id];
    if (listed) {
        return listed;
    }
    if (model.provider === 'ollama') {
        return COST_BADGE_PRICES.free;
    }
    if (model.provider === 'ingot') {
        return GATEWAY_PRICE_TIERS.find(t => t.test.test(model.model))?.price ?? GATEWAY_DEFAULT_PRICE;
    }
    return COST_BADGE_PRICES[model.cost];
};

/** One number to compare models by: input and output weighted like a typical agent step (3:1). */
export const blendedPrice = (price: ModelPrice): number => (price.input * 3 + price.output) / 4;

/**
 * Tokens and USD for the next run. Each round re-sends the system prompt, the history and the prompt plus the output
 * of the rounds before it.
 */
export const estimateRunCost = (input: CostInput): CostEstimate => {
    const rounds = MODE_ROUNDS[input.mode] ?? DEFAULT_ROUNDS;
    const perRound = MODE_OUTPUT_TOKENS[input.mode] ?? DEFAULT_OUTPUT_TOKENS;
    const base = input.systemTokens + input.historyTokens + input.promptTokens;
    let inputTokens = 0;
    for (let round = 0; round < rounds; round++) {
        inputTokens += base + round * perRound;
    }
    const outputTokens = rounds * perRound;
    const usd = (inputTokens * input.price.input + outputTokens * input.price.output) / TOKENS_PER_MILLION;
    return { inputTokens, outputTokens, usd };
};

export const formatUsd = (usd: number): string => {
    if (usd <= 0) {
        return '$0';
    }
    if (usd < MIN_SMALL_USD) {
        return `<$${MIN_SMALL_USD}`;
    }
    if (usd < MIN_SHOWN_USD) {
        return `$${usd.toFixed(SMALL_USD_DIGITS)}`;
    }
    return usd >= WHOLE_DOLLARS_FROM ? `$${Math.round(usd)}` : `$${usd.toFixed(2)}`;
};

/** "~$0.04" for an estimate ("<$0.001" stays as it is). */
export const approxUsd = (usd: number): string => {
    const text = formatUsd(usd);
    return text.startsWith('$') ? `~${text}` : text;
};

/** A free run (a local model) shows no estimate in the composer, unless it was routed or is over the warning. */
export const showsForecast = (forecast: Pick<CostForecast, 'estimate' | 'routed' | 'over'>): boolean =>
    forecast.estimate.usd > 0 || forecast.over || !!forecast.routed;

export const formatPrice = (price: ModelPrice): string => price.input === 0 && price.output === 0 ? 'free' : `$${price.input} in / $${price.output} out per 1M tokens`;

export const isOverBudget = (usd: number, warnUsd: number): boolean => warnUsd > 0 && usd > warnUsd;
