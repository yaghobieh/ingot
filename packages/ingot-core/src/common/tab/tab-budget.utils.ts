import { TAB_CHARS_PER_TOKEN } from './tab.consts';
import type { TabBudgetBlock, TabLimits, TabUsage } from './tab.types';

const pad = (n: number): string => String(n).padStart(2, '0');

/** Local calendar day (YYYY-MM-DD); the caps reset at local midnight. */
export const tabDay = (date: Date): string => `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`;

export const usageForDay = (stored: TabUsage | undefined, day: string): TabUsage =>
    stored?.day === day ? stored : { day, requests: 0, tokens: 0 };

export const estimateTokens = (text: string): number => Math.ceil(text.length / TAB_CHARS_PER_TOKEN);

/** Why the next request must not be sent, or undefined when it fits today's caps. */
export const budgetBlock = (usage: TabUsage, limits: TabLimits, estimatedTokens: number): TabBudgetBlock | undefined => {
    if (usage.requests >= limits.maxRequestsPerDay) {
        return 'requests';
    }
    return usage.tokens + estimatedTokens > limits.maxTokensPerDay ? 'tokens' : undefined;
};

export const addUsage = (usage: TabUsage, tokens: number): TabUsage =>
    ({ ...usage, requests: usage.requests + 1, tokens: usage.tokens + tokens });
