import type { CatalogModel } from '../models/models.types';
import { DEFAULT_CONTEXT_WINDOW } from '../models/models.consts';
import type { AccountSnapshot, AccountTokens, GatewayModelInfo } from './account-protocol';
import { DEV_LOGIN_PATH, INGOT_MODEL_PREFIX } from './account.consts';
import type { IdeStatusResponse } from './shared/ide-auth.types';

export const isIngotModel = (id: string): boolean => id.startsWith(INGOT_MODEL_PREFIX);
export const ingotModelId = (gatewayId: string): string => `${INGOT_MODEL_PREFIX}${gatewayId}`;
export const gatewayModelName = (id: string): string => id.slice(INGOT_MODEL_PREFIX.length);

/** Parses GET /v1/models in the server's order (IDEA-124: `order`, then as listed); drops malformed rows. */
export const parseGatewayModels = (json: unknown): GatewayModelInfo[] => {
    const body = json && typeof json === 'object' ? json as { data?: unknown; default?: unknown } : {};
    const data = Array.isArray(body.data) ? body.data : [];
    const defaultId = typeof body.default === 'string' ? body.default : undefined;
    const rows = data.flatMap((row, index) => {
        const r = row && typeof row === 'object' ? row as Record<string, unknown> : {};
        if (typeof r.id !== 'string' || !r.id) {
            return [];
        }
        return [{
            id: r.id,
            label: typeof r.name === 'string' && r.name ? r.name : r.id,
            contextWindow: typeof r.context_window === 'number' && r.context_window > 0 ? r.context_window : DEFAULT_CONTEXT_WINDOW,
            available: r.available !== false,
            order: typeof r.order === 'number' && Number.isFinite(r.order) ? r.order : index,
            isDefault: defaultId ? r.id === defaultId : r.default === true,
            ...(typeof r.unavailable_reason === 'string' && r.unavailable_reason ? { reason: r.unavailable_reason } : {}),
            index
        }];
    });
    return rows.sort((a, b) => a.order - b.order || a.index - b.index).map(({ index: _index, ...model }) => model);
};

/** Model to use when nothing is picked or the saved one is gone: the server default if it can run, else the first that can. */
export const defaultGatewayModel = (models: readonly GatewayModelInfo[]): GatewayModelInfo | undefined =>
    models.find(m => m.isDefault && m.available) ?? models.find(m => m.available);

/** Headers every Ingot server call sends (contract §0): build version and UI language. */
export const ideHeaders = (version: string, language = 'en'): Record<string, string> => ({ 'X-Ingot-IDE-Version': version, 'Accept-Language': language });

export const UNAVAILABLE_MODEL_HINT = 'No provider can run this model right now';

/** Picker entry for a gateway model. Labels are model names only (no costs in the picker). */
export const toCatalogModel = (m: Pick<GatewayModelInfo, 'id' | 'label' | 'contextWindow'>): CatalogModel => ({
    id: ingotModelId(m.id), label: m.label, provider: 'ingot', model: m.id,
    speed: /fast|flash|mini|haiku/i.test(m.id) ? 'fast' : /reason|r1|pro|opus/i.test(m.id) ? 'slow' : 'balanced',
    cost: '$', contextWindow: m.contextWindow, thinking: /reason|r1/i.test(m.id), recommended: /^ingot-(fast|smart)$/.test(m.id)
});

/** `role` from GET /api/me (`{ user: { role } }`). */
export const roleOf = (json: unknown): string | undefined => {
    const user = json && typeof json === 'object' ? (json as { user?: { role?: unknown } }).user : undefined;
    return typeof user?.role === 'string' ? user.role : undefined;
};

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
