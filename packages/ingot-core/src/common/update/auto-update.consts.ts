/** Set to 1/true to turn off update checks (managed installs, CI, e2e). */
export const AUTO_UPDATE_DISABLE_ENV = 'INGOT_DISABLE_AUTO_UPDATE';
/** electron-updater can only replace AppImage builds on Linux; .deb installs update through apt. */
export const APPIMAGE_ENV = 'APPIMAGE';
/** First check shortly after launch, so it never competes with startup. */
export const AUTO_UPDATE_FIRST_CHECK_MS = 15_000;
export const AUTO_UPDATE_INTERVAL_MS = 6 * 60 * 60 * 1000;
export const TRUTHY_ENV = ['1', 'true', 'yes'] as const;
/** Built-in language plugins packaged next to the app (electron-builder extraResources). */
export const PACKAGED_PLUGINS_DIR = 'plugins';
export const DEFAULT_PLUGINS_ENV = 'THEIA_DEFAULT_PLUGINS';
export const LOCAL_DIR_PLUGIN_PREFIX = 'local-dir:';
