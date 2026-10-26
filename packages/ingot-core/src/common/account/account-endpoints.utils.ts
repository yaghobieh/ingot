import { PORTAL_URL_ENV, SERVER_URL_ENV } from './account.consts';

export interface BakedEndpoints {
    serverUrl?: unknown;
    portalUrl?: unknown;
}

const asHttpUrl = (value: unknown): string | undefined => {
    if (typeof value !== 'string' || !value.trim()) {
        return undefined;
    }
    try {
        const url = new URL(value.trim());
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString().replace(/\/$/, '') : undefined;
    } catch {
        return undefined;
    }
};

/**
 * IDEA-140: env vars to set from the URLs baked into a release build.
 * A value already in the environment wins; empty or invalid baked values are ignored (dev keeps localhost).
 */
export function bakedEndpointEnv(baked: BakedEndpoints | undefined, env: Record<string, string | undefined>): Record<string, string> {
    const result: Record<string, string> = {};
    const pairs: Array<[string, unknown]> = [[SERVER_URL_ENV, baked?.serverUrl], [PORTAL_URL_ENV, baked?.portalUrl]];
    for (const [name, value] of pairs) {
        const url = asHttpUrl(value);
        if (url && !env[name]?.trim()) {
            result[name] = url;
        }
    }
    return result;
}
