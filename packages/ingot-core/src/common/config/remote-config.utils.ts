import { DEFAULT_CONFIG_TTL_SECONDS, DEFAULT_DOWNLOAD_URL, IDE_FLAG_DEFAULTS, MAX_CONFIG_TTL_SECONDS, MIN_CONFIG_TTL_SECONDS } from './remote-config.consts';
import type { IdeUpdatePolicy, RemoteConfig } from './remote-config.types';

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const str = (value: unknown): string | null => typeof value === 'string' && value ? value : null;

/** Built-in config before the server ever answered: no flags from the server, no update policy. */
export const defaultRemoteConfig = (version: string): RemoteConfig => ({
    flags: {}, values: {}, config: {}, ttlSeconds: DEFAULT_CONFIG_TTL_SECONDS, signedIn: false,
    ide: { version, minVersion: null, latestVersion: null, updateAvailable: false, forceUpdate: false, downloadUrl: DEFAULT_DOWNLOAD_URL, releaseNotesUrl: null }
});

/** Parses GET /v1/config defensively; anything malformed falls back to the built-in default. */
export const parseRemoteConfig = (json: unknown, version: string): RemoteConfig => {
    const body = record(json);
    const fallback = defaultRemoteConfig(version);
    const flags = Object.fromEntries(Object.entries(record(body.flags)).filter(([, v]) => typeof v === 'boolean')) as Record<string, boolean>;
    const ide = record(body.ide);
    const ttl = typeof body.ttlSeconds === 'number' && Number.isFinite(body.ttlSeconds) ? body.ttlSeconds : DEFAULT_CONFIG_TTL_SECONDS;
    const policy: IdeUpdatePolicy = {
        version: str(ide.version) ?? version,
        minVersion: str(ide.minVersion),
        latestVersion: str(ide.latestVersion),
        updateAvailable: ide.updateAvailable === true,
        forceUpdate: ide.forceUpdate === true,
        downloadUrl: safeUrl(str(ide.downloadUrl)) ?? fallback.ide.downloadUrl,
        releaseNotesUrl: safeUrl(str(ide.releaseNotesUrl))
    };
    return {
        flags, values: record(body.values), config: record(body.config), ide: policy, signedIn: body.signedIn === true,
        ttlSeconds: Math.min(MAX_CONFIG_TTL_SECONDS, Math.max(MIN_CONFIG_TTL_SECONDS, Math.round(ttl)))
    };
};

/** Only http(s) links are opened from the config (download / release notes). */
export const safeUrl = (value: string | null): string | null => {
    if (!value) {
        return null;
    }
    try {
        const url = new URL(value);
        return url.protocol === 'https:' || url.protocol === 'http:' ? url.toString() : null;
    } catch {
        return null;
    }
};

/** A server flag wins; otherwise the IDE's built-in default for flags it knows; unknown flags are off. */
export const flagEnabled = (config: RemoteConfig, key: string): boolean => {
    if (typeof config.flags[key] === 'boolean') {
        return config.flags[key];
    }
    return (IDE_FLAG_DEFAULTS as Record<string, boolean | undefined>)[key] ?? false;
};

/** A remote config value of the same type as the built-in default, else the default. */
export const configValue = <T>(config: RemoteConfig, key: string, fallback: T): T => {
    const value = config.config[key];
    return value !== undefined && value !== null && typeof value === typeof fallback ? value as T : fallback;
};

/** Semver-ish compare of x.y.z (pre-release tags sort before the release). */
export const compareVersions = (a: string, b: string): number => {
    const parse = (v: string) => {
        const [core, pre] = v.split('-', 2);
        return { parts: core.split('.').map(n => Number.parseInt(n, 10) || 0), pre };
    };
    const x = parse(a);
    const y = parse(b);
    for (let i = 0; i < 3; i++) {
        const d = (x.parts[i] ?? 0) - (y.parts[i] ?? 0);
        if (d !== 0) {
            return Math.sign(d);
        }
    }
    if (x.pre === y.pre) {
        return 0;
    }
    return x.pre === undefined ? 1 : y.pre === undefined ? -1 : x.pre < y.pre ? -1 : 1;
};

/** What the update UI shows. `dismissed` = the latestVersion the user said "Later" to. */
export const updateState = (policy: IdeUpdatePolicy, current: string, dismissed?: string): 'force' | 'notice' | 'none' => {
    if (policy.forceUpdate || (policy.minVersion && compareVersions(current, policy.minVersion) < 0)) {
        return 'force';
    }
    const latest = policy.latestVersion;
    const newer = policy.updateAvailable || (!!latest && compareVersions(current, latest) < 0);
    if (!newer || (latest && dismissed === latest)) {
        return 'none';
    }
    return 'notice';
};
