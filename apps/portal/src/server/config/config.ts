import 'server-only';
import { existsSync, readFileSync } from 'node:fs';
import { join } from 'node:path';
import { CONFIG_FILE_NAME, CONFIG_PATH_ENV, DATABASE_URL_ENV, DEFAULT_CONFIG } from '@server/config/config.consts';
import type { PortalConfig } from '@server/config/config.types';

let cached: PortalConfig | undefined;

function deepMerge<T>(base: T, override: unknown): T {
    if (!override || typeof override !== 'object' || Array.isArray(override)) { return base; }
    const out: Record<string, unknown> = { ...(base as Record<string, unknown>) };
    for (const [key, value] of Object.entries(override as Record<string, unknown>)) {
        const current = out[key];
        out[key] = current && typeof current === 'object' && !Array.isArray(current) ? deepMerge(current, value) : value;
    }
    return out as T;
}

/** Reads the gitignored ingot.config.json (path overridable with INGOT_CONFIG). Values are never logged. */
export function getConfig(): PortalConfig {
    if (cached) { return cached; }
    const path = process.env[CONFIG_PATH_ENV] ?? join(/* turbopackIgnore: true */ process.cwd(), CONFIG_FILE_NAME);
    const fileConfig: unknown = existsSync(path) ? JSON.parse(readFileSync(path, 'utf8')) : {};
    const merged = deepMerge(DEFAULT_CONFIG, fileConfig);
    const dbUrl = process.env[DATABASE_URL_ENV];
    cached = dbUrl ? { ...merged, database: { ...merged.database, url: dbUrl } } : merged;
    return cached;
}
