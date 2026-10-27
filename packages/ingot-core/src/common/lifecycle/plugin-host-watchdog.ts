/**
 * IDEA-170 (part 2): a plugin host must not outlive the backend that forked it. Theia's plugin host has no
 * disconnect handling, so a backend that is killed (SIGKILL, a crashed or force-quit dev server, a killed e2e
 * web server) left its plugin host and that host's language servers (JSON, …) running forever, reparented to pid 1.
 * The backend preloads this watchdog into every plugin host via NODE_OPTIONS: when the IPC channel to the backend
 * closes, or the backend pid disappears, the host terminates itself (its language servers follow, they watch it).
 */
export const WATCHDOG_ENV = 'INGOT_PLUGIN_HOST_WATCHDOG';
export const WATCHDOG_FILE_NAME = 'ingot-plugin-host-watchdog-v1.js';
export const WATCHDOG_INTERVAL_MS = 5000;
export const WATCHDOG_KILL_AFTER_MS = 3000;

/** Plain JS (runs before the plugin host via --require); disarms itself for the host's own children. */
export const WATCHDOG_SOURCE = `'use strict';
(function () {
    var armed = process.env.${WATCHDOG_ENV} === '1';
    delete process.env.${WATCHDOG_ENV};
    if (process.env.NODE_OPTIONS) {
        process.env.NODE_OPTIONS = process.env.NODE_OPTIONS.replace(/\\s*--require\\s+"[^"]*${WATCHDOG_FILE_NAME.replace(/\./g, '\\.')}"/g, '').trim();
    }
    if (!armed || typeof process.send !== 'function' || !/plugin-host(\\.js)?$/.test(process.argv[1] || '')) {
        return;
    }
    var parent = process.ppid;
    var stopping = false;
    var stop = function () {
        if (stopping) { return; }
        stopping = true;
        try { process.kill(process.pid, 'SIGTERM'); } catch (e) { /* ignore */ }
        setTimeout(function () { try { process.kill(process.pid, 'SIGKILL'); } catch (e) { /* ignore */ } }, ${WATCHDOG_KILL_AFTER_MS}).unref();
    };
    var alive = function (pid) {
        try { process.kill(pid, 0); return true; } catch (e) { return e && e.code === 'EPERM'; }
    };
    process.once('disconnect', stop);
    setInterval(function () { if (process.ppid !== parent || !alive(parent)) { stop(); } }, ${WATCHDOG_INTERVAL_MS}).unref();
})();
`;

/** Quotes a path for NODE_OPTIONS (spaces and Windows backslashes). */
export const nodeOptionsPath = (file: string): string => `"${file.replace(/\\/g, '\\\\').replace(/"/g, '\\"')}"`;

/** NODE_OPTIONS with the watchdog preload added once. */
export const withWatchdogPreload = (nodeOptions: string | undefined, file: string): string => {
    const current = (nodeOptions ?? '').trim();
    if (current.includes(WATCHDOG_FILE_NAME)) {
        return current;
    }
    return [current, `--require ${nodeOptionsPath(file)}`].filter(Boolean).join(' ');
};
