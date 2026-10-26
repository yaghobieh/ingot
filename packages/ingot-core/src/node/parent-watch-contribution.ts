import { injectable } from '@theia/core/shared/inversify';
import type { BackendApplicationContribution } from '@theia/core/lib/node/backend-application';
import { ELECTRON_BACKEND_ENV, FORCED_EXIT_AFTER_MS, PARENT_WATCH_INTERVAL_MS } from '../common/lifecycle/lifecycle.consts';
import { isElectronForkedBackend, isParentGone, isProcessAlive } from '../common/lifecycle/lifecycle.utils';

/**
 * IDEA-170: the desktop backend must not outlive the Electron main process. Theia only stops the backend on a clean
 * quit; if the main process is killed or crashes, the backend, plugin host, file watcher and language servers kept
 * running. When the parent goes away (IPC disconnect, or the watchdog notices) we run Theia's own graceful shutdown,
 * which stops contributions and then terminates the whole backend process tree on Windows, macOS and Linux.
 */
@injectable()
export class ParentWatchContribution implements BackendApplicationContribution {

    protected stopping = false;

    initialize(): void {
        if (!isElectronForkedBackend(process.env, typeof process.send === 'function', ELECTRON_BACKEND_ENV)) {
            return;
        }
        const originalPpid = process.ppid;
        process.once('disconnect', () => this.shutdown('the main process disconnected'));
        const timer = setInterval(() => {
            if (isParentGone(originalPpid, process.ppid, isProcessAlive)) {
                this.shutdown(`the main process (pid ${originalPpid}) is gone`);
            }
        }, PARENT_WATCH_INTERVAL_MS);
        timer.unref();
    }

    protected shutdown(reason: string): void {
        if (this.stopping) {
            return;
        }
        this.stopping = true;
        console.info(`[ingot] Stopping the backend: ${reason}.`);
        // Theia's BackendApplication handles SIGTERM with gracefulShutdown() -> process.exit() -> terminateProcessTree().
        // Emitting runs that handler on every OS (Windows has no real SIGTERM delivery).
        process.emit('SIGTERM' as NodeJS.Signals, 'SIGTERM' as NodeJS.Signals);
        setTimeout(() => process.exit(1), FORCED_EXIT_AFTER_MS).unref();
    }
}
