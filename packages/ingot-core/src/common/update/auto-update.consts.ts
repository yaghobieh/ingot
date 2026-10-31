import type { UpdateChannel } from './auto-update.types';

/** Set to 1/true to turn off update checks (managed installs, CI, e2e). */
export const AUTO_UPDATE_DISABLE_ENV = 'INGOT_DISABLE_AUTO_UPDATE';
/** Dev runs only (ignored in packaged builds): simulate a published update with this version, for e2e and demos. */
export const AUTO_UPDATE_SIMULATE_ENV = 'INGOT_UPDATE_SIMULATE';
/** electron-updater can only replace AppImage builds on Linux; .deb installs update through apt. */
export const APPIMAGE_ENV = 'APPIMAGE';
/** First check shortly after launch, so it never competes with startup. */
export const AUTO_UPDATE_FIRST_CHECK_MS = 15_000;
export const AUTO_UPDATE_INTERVAL_MS = 4 * 60 * 60 * 1000;
/** Pace of the simulated download (dev/e2e). */
export const SIMULATED_STEP_MS = 400;
export const SIMULATED_PROGRESS_STEPS = [25, 60, 100] as const;
export const PERCENT_MAX = 100;
export const TRUTHY_ENV = ['1', 'true', 'yes'] as const;
/** Built-in language plugins packaged next to the app (electron-builder extraResources). */
export const PACKAGED_PLUGINS_DIR = 'plugins';
export const DEFAULT_PLUGINS_ENV = 'THEIA_DEFAULT_PLUGINS';
export const LOCAL_DIR_PLUGIN_PREFIX = 'local-dir:';

export const UPDATE_CHANNELS = ['stable', 'beta'] as const satisfies readonly UpdateChannel[];
export const UPDATE_CHANNEL_PREFERENCE = 'ingot.update.channel';

export const INGOT_UPDATER_PATH = '/services/ingot-updater';
export const IngotUpdater = Symbol('IngotUpdater');

export const UPDATER_COMMANDS = {
    checkForUpdates: { id: 'ingot.update.check', label: 'Check for Updates…', category: 'Ingot' },
    restartToUpdate: { id: 'ingot.update.restart', label: 'Restart to Update', category: 'Ingot' }
} as const;

export const UPDATER_TEXT = {
    restart: 'Restart to Update',
    later: 'Later',
    ready: (version: string) => `Ingot ${version} is ready. Restart to update.`,
    downloading: (version: string) => `Downloading Ingot ${version} in the background…`,
    upToDate: (version: string) => `You're on the latest version of Ingot (${version}).`,
    checking: 'Checking for updates…',
    failed: (error: string) => `Couldn't check for updates: ${error}`,
    disabled: {
        'dev-build': 'Updates are off in development builds.',
        'disabled-by-env': 'Updates are turned off on this machine (INGOT_DISABLE_AUTO_UPDATE).',
        'linux-package-manager': 'This install updates through your package manager (apt).'
    },
    forceDownloading: (version: string, percent: number) => `Downloading Ingot ${version}… ${percent}%`,
    forceReady: (version: string) => `Ingot ${version} is downloaded. Restart to finish updating.`,
    channelDescription: 'Which Ingot releases the desktop app updates to. Stable: releases only. Beta: also pre-releases. Pre-release builds default to Beta.'
} as const;
