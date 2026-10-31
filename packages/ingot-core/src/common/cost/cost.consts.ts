import type { ModelPrice } from './cost.types';

export const COST_PREFS = {
    forecast: 'ingot.agent.cost.forecast',
    warnUsd: 'ingot.agent.cost.warnUsd'
} as const;
export const DEFAULT_WARN_USD = 0.5;
export const TOKENS_PER_MILLION = 1_000_000;
/** System prompt, protocols and rules before the chat's first request measured them. */
export const DEFAULT_SYSTEM_TOKENS = 3_000;

/** List prices in USD per 1M tokens for the built-in catalog (input / output). */
export const MODEL_PRICES: Readonly<Record<string, ModelPrice>> = {
    'claude-sonnet-4-5': { input: 3, output: 15 },
    'claude-opus-4-1': { input: 15, output: 75 },
    'gpt-5': { input: 1.25, output: 10 },
    'gpt-5-mini': { input: 0.25, output: 2 },
    'gemini-2-5-pro': { input: 1.25, output: 10 },
    'deepseek-v3': { input: 0.27, output: 1.1 },
    'openrouter-auto': { input: 3, output: 15 },
    'ollama-local': { input: 0, output: 0 }
};

/** Gateway (Ingot) models are priced by tier from their name; the first matching tier wins. */
export const GATEWAY_PRICE_TIERS: readonly { readonly test: RegExp; readonly price: ModelPrice }[] = [
    { test: /fast|mini|flash|haiku|small|lite|nano/i, price: { input: 0.25, output: 1.25 } },
    { test: /reason|opus|large|ultra|max|r1/i, price: { input: 15, output: 75 } }
];
export const GATEWAY_DEFAULT_PRICE: ModelPrice = { input: 3, output: 15 };
/** Badge prices for models outside the table. */
export const COST_BADGE_PRICES: Readonly<Record<'free' | '$' | '$$' | '$$$', ModelPrice>> = {
    free: { input: 0, output: 0 }, $: { input: 0.25, output: 2 }, $$: { input: 3, output: 15 }, $$$: { input: 15, output: 75 }
};

/** Expected model rounds and output tokens per round, by chat mode (tool loops take several rounds). */
export const MODE_ROUNDS: Readonly<Record<string, number>> = { ask: 1, plan: 1, agent: 3, debug: 3, multi: 5 };
export const MODE_OUTPUT_TOKENS: Readonly<Record<string, number>> = { ask: 700, plan: 900, agent: 1500, debug: 1200, multi: 1500 };
export const DEFAULT_ROUNDS = 1;
export const DEFAULT_OUTPUT_TOKENS = 1000;
/** Prices below this show as "<$0.01". */
export const MIN_SHOWN_USD = 0.01;
/** Estimates under a cent show tenths of a cent ($0.004); under this, "<$0.001". */
export const MIN_SMALL_USD = 0.001;
export const SMALL_USD_DIGITS = 3;
export const WHOLE_DOLLARS_FROM = 10;
