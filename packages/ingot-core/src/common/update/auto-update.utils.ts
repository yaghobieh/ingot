import { APPIMAGE_ENV, AUTO_UPDATE_DISABLE_ENV, LOCAL_DIR_PLUGIN_PREFIX, TRUTHY_ENV } from './auto-update.consts';
import type { AutoUpdateDecision, AutoUpdateEnvironment } from './auto-update.types';

const isTruthy = (value: string | undefined) => (TRUTHY_ENV as readonly string[]).includes((value ?? '').trim().toLowerCase());

/** A semver pre-release (`0.1.0-beta.1`) follows pre-releases too. */
export const isPrereleaseVersion = (version: string): boolean => /^\d+\.\d+\.\d+-/.test(version.trim());

/** Whether the desktop app checks GitHub Releases for updates (IDEA-134). */
export function autoUpdateDecision({ isPackaged, platform, version, env }: AutoUpdateEnvironment): AutoUpdateDecision {
    const allowPrerelease = isPrereleaseVersion(version);
    if (!isPackaged) {
        return { enabled: false, reason: 'dev-build', allowPrerelease };
    }
    if (isTruthy(env[AUTO_UPDATE_DISABLE_ENV])) {
        return { enabled: false, reason: 'disabled-by-env', allowPrerelease };
    }
    if (platform === 'linux' && !env[APPIMAGE_ENV]) {
        return { enabled: false, reason: 'linux-package-manager', allowPrerelease };
    }
    return { enabled: true, allowPrerelease };
}

/** THEIA_DEFAULT_PLUGINS value for a packaged app: its bundled plugins folder (unless the user set one). */
export function defaultPluginsValue(current: string | undefined, pluginsDir: string): string {
    return current?.trim() ? current : `${LOCAL_DIR_PLUGIN_PREFIX}${pluginsDir}`;
}
