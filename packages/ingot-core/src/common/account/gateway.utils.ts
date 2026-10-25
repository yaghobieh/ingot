import type { CatalogModel } from '../models/models.types';
import { DEFAULT_CONTEXT_WINDOW } from '../models/models.consts';
import type { AccountSnapshot, AccountTokens, GatewayModelInfo } from './account-protocol';
import { DEV_LOGIN_PATH, INGOT_MODEL_PREFIX } from './account.consts';
import type { IdeStatusResponse } from './shared/ide-auth.types';

export const isIngotModel = (id: string): boolean => id.startsWith(INGOT_MODEL_PREFIX);
export const ingotModelId = (gatewayId: string): string => `${INGOT_MODEL_PREFIX}${gatewayId}`;
export const gatewayModelName = (id: string): string => id.slice(INGOT_MODEL_PREFIX.length);

/** Parses GET /v1/models; drops malformed rows. */
export const parseGatewayModels = (json: unknown): GatewayModelInfo[] => {
    const data = json && typeof json === 'object' && Array.isArray((json as { data?: unknown }).data) ? (json as { data: unknown[] }).data : [];
    return data.flatMap(row => {
        const r = row && typeof row === 'object' ? row as Record<string, unknown> : {};
        if (typeof r.id !== 'string' || !r.id) {
            return [];
        }
        return [{
            id: r.id,
            label: typeof r.name === 'string' && r.name ? r.name : r.id,
            contextWindow: typeof r.context_window === 'number' && r.context_window > 0 ? r.context_window : DEFAULT_CONTEXT_WINDOW,
            available: r.available !== false
        }];
    });
};

/** Picker entry for a gateway model. Labels are model names only (no costs in the picker). */
export const toCatalogModel = (m: Pick<GatewayModelInfo, 'id' | 'label' | 'contextWindow'>): CatalogModel => ({
    id: ingotModelId(m.id), label: m.label, provider: 'ingot', model: m.id,
    speed: /fast|flash|mini|haiku/i.test(m.id) ? 'fast' : /reason|r1|pro|opus/i.test(m.id) ? 'slow' : 'balanced',
    cost: '$', contextWindow: m.contextWindow, thinking: /reason|r1/i.test(m.id), recommended: /^ingot-(fast|smart)$/.test(m.id)
});

export const tokensOf = (status: IdeStatusResponse): AccountTokens => {
    const t = status.balance.tokens;
    return { used: t.used, remaining: Math.max(0, t.remaining), allowance: t.allowance + t.granted };
};

export const snapshotOf = (status: IdeStatusResponse, now = Date.now()): AccountSnapshot => ({
    signedIn: true,
    user: { name: status.user.name || status.user.email, email: status.user.email, plan: status.user.plan, avatarUrl: status.user.avatarUrl || undefined },
    tokens: tokensOf(status),
    updatedAt: now
});

/** "1.2M left" style label for the status bar. */
export const tokensLeftLabel = (tokens: AccountTokens): string => {
    const n = tokens.remaining;
    const short = n >= 1_000_000 ? `${(Math.floor(n / 100_000) / 10).toString()}M` : n >= 1000 ? `${Math.floor(n / 1000)}k` : String(n);
    return `${short} left`;
};

export const usedRatio = (tokens: AccountTokens): number => tokens.allowance > 0 ? Math.min(1, tokens.used / tokens.allowance) : 0;

/** Portal dev login that lands on `next` signed in as a seeded @ingot.dev account (loopback only). */
export const devLoginUrl = (portalUrl: string, email: string, next: string): string =>
    `${portalUrl.replace(/\/$/, '')}${DEV_LOGIN_PATH}?${new URLSearchParams({ email, next })}`;

/** Only loopback servers get the dev sign-in. */
export const isLoopbackUrl = (url: string): boolean => {
    try {
        return ['127.0.0.1', 'localhost', '[::1]'].includes(new URL(url).hostname);
    } catch {
        return false;
    }
};
