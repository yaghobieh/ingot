/** IDEA-266: the Zaprex desktop app as each OS knows it. */
export const ZAPREX_APP_NAME = 'Zaprex';
export const ZAPREX_MAC_BUNDLE = 'Zaprex.app';
export const ZAPREX_MAC_APPLICATIONS = '/Applications';
export const ZAPREX_WINDOWS_EXE = 'Zaprex.exe';
export const ZAPREX_LINUX_BIN = 'zaprex';
export const ZAPREX_LINUX_DIRS = ['/usr/bin', '/usr/local/bin', '/opt/Zaprex'] as const;
/** Started apps get this long to fail before the launch counts as done. */
export const ZAPREX_LAUNCH_TIMEOUT_MS = 5000;
/** Written to INGOT_ZAPREX_LINK_LOG (e2e) instead of starting the app. */
export const ZAPREX_LAUNCH_LOG_LINE = 'launch:Zaprex';
