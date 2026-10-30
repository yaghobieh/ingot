import { compareVersions } from '../config/remote-config.utils';
import { APPIMAGE_ENV, AUTO_UPDATE_DISABLE_ENV, AUTO_UPDATE_SIMULATE_ENV, LOCAL_DIR_PLUGIN_PREFIX, TRUTHY_ENV, UPDATE_CHANNELS } from './auto-update.consts';
import type { AutoUpdateDecision, AutoUpdateEnvironment, UpdateChannel } from './auto-update.types';

const isTruthy = (value: string | undefined) => (TRUTHY_ENV as readonly string[]).includes((value ?? '').trim().toLowerCase());

/** A semver pre-release (`0.1.0-beta.1`) follows pre-releases too. */
export const isPrereleaseVersion = (version: string): boolean => /^\d+\.\d+\.\d+-/.test(version.trim());

export const isUpdateChannel = (value: unknown): value is UpdateChannel => (UPDATE_CHANNELS as readonly unknown[]).includes(value);

/** The user's `ingot.update.channel` when set, else beta for pre-release builds and stable for releases. */
export const resolveChannel = (picked: unknown, version: string): UpdateChannel =>
    isUpdateChannel(picked) ? picked : isPrereleaseVersion(version) ? 'beta' : 'stable';

/** A required update may itself be a pre-release (minVersion `0.2.0-beta.1`), so the stable channel must see it. */
export const allowPrereleaseFor = (channel: UpdateChannel, minVersion?: string): boolean =>
    channel === 'beta' || (!!minVersion && isPrereleaseVersion(minVersion));

export const isBelowMinVersion = (current: string, minVersion: string | null | undefined): boolean =>
    !!minVersion?.trim() && compareVersions(current, minVersion.trim()) < 0;

/** Whether the desktop app checks GitHub Releases for updates (IDEA-134, IDEA-269). */
export function autoUpdateDecision({ isPackaged, platform, version, env }: AutoUpdateEnvironment): AutoUpdateDecision {
    const defaultChannel = resolveChannel(undefined, version);
    if (isTruthy(env[AUTO_UPDATE_DISABLE_ENV])) {
        return { enabled: false, reason: 'disabled-by-env', defaultChannel };
    }
    if (!isPackaged) {
        const simulatedVersion = env[AUTO_UPDATE_SIMULATE_ENV]?.trim();
        return simulatedVersion ? { enabled: true, defaultChannel, simulatedVersion } : { enabled: false, reason: 'dev-build', defaultChannel };
    }
    if (platform === 'linux' && !env[APPIMAGE_ENV]) {
        return { enabled: false, reason: 'linux-package-manager', defaultChannel };
    }
    return { enabled: true, defaultChannel };
}

/** THEIA_DEFAULT_PLUGINS value for a packaged app: its bundled plugins folder (unless the user set one). */
export function defaultPluginsValue(current: string | undefined, pluginsDir: string): string {
    return current?.trim() ? current : `${LOCAL_DIR_PLUGIN_PREFIX}${pluginsDir}`;
}
