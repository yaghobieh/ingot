/** IDEA-170: clean shutdown of the desktop app's process tree on every OS. */

/** How often the backend checks that the Electron main process that forked it is still alive. */
export const PARENT_WATCH_INTERVAL_MS = 2000;

/** Hard stop if a graceful shutdown hangs (Theia gives each shutdown phase its own budget). */
export const FORCED_EXIT_AFTER_MS = 10_000;

/** Signals that should quit the desktop app gracefully instead of killing only the main process. */
export const QUIT_SIGNALS = ['SIGTERM', 'SIGINT', 'SIGHUP'] as const;

/** Set by Theia's Electron main process before it forks the backend. */
export const ELECTRON_BACKEND_ENV = 'THEIA_ELECTRON_VERSION';
