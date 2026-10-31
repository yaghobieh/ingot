import * as fs from 'fs';
import * as path from 'path';
import {
    AQ_KEYCHAIN_SERVICE, AQ_KEYSTORE_FILE, BUDGET_LIMIT_USD, BUDGET_STOP_USD, LOCAL_CONFIG_FILE, OPENROUTER_KEY_ENV, OPENROUTER_KEY_URL, OPENROUTER_PROVIDER
} from './agent-quality.consts';

export interface BudgetStatus {
    readonly usage: number;
    readonly limit: number;
    readonly stopAt: number;
    readonly ok: boolean;
}

/** OpenRouter key from the environment or the gitignored ingot.config.json. Never printed. */
export const resolveOpenRouterKey = (): string | undefined => {
    const fromEnv = process.env[OPENROUTER_KEY_ENV]?.trim();
    if (fromEnv) {
        return fromEnv;
    }
    try {
        const config = JSON.parse(fs.readFileSync(LOCAL_CONFIG_FILE, 'utf8')) as { ai?: { openrouterApiKey?: unknown } };
        const key = config.ai?.openrouterApiKey;
        return typeof key === 'string' && key.trim() ? key.trim() : undefined;
    } catch {
        return undefined;
    }
};

export const MISSING_KEY = `No OpenRouter key. Set ${OPENROUTER_KEY_ENV} or ai.openrouterApiKey in the gitignored ingot.config.json, then run again.`;

/** GET /api/v1/key. Only dollar amounts leave this function. */
export const checkBudget = async (key: string): Promise<BudgetStatus> => {
    const response = await fetch(OPENROUTER_KEY_URL, { headers: { authorization: `Bearer ${key}` } });
    if (!response.ok) {
        throw new Error(`OpenRouter key check failed (${response.status}).`);
    }
    const body = await response.json() as { data?: { usage?: unknown; limit?: unknown } };
    const usage = Number(body.data?.usage ?? 0);
    const limit = Math.min(Number(body.data?.limit ?? BUDGET_LIMIT_USD) || BUDGET_LIMIT_USD, BUDGET_LIMIT_USD);
    return { usage, limit, stopAt: BUDGET_STOP_USD, ok: usage < BUDGET_STOP_USD };
};

export const budgetLine = (status: BudgetStatus): string =>
    `OpenRouter usage $${status.usage.toFixed(2)} of $${status.limit.toFixed(2)} (hard stop at $${status.stopAt.toFixed(2)})`;

/** Writes the key into the dev file key store (mode 0600) the app reads instead of the OS keychain. */
export const seedKeyStore = (key: string, file = AQ_KEYSTORE_FILE, service = AQ_KEYCHAIN_SERVICE): void => {
    let store: Record<string, Record<string, string>> = {};
    try {
        store = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, Record<string, string>>;
    } catch {
        store = {};
    }
    store[service] = { ...(store[service] ?? {}), [OPENROUTER_PROVIDER]: key };
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    fs.writeFileSync(file, JSON.stringify(store), { mode: 0o600 });
    fs.chmodSync(file, 0o600);
};
