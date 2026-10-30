import { app } from '@theia/core/electron-shared/electron';
import * as electronUpdater from 'electron-updater';
import type { AutoUpdateDecision, UpdateDriver, UpdateDriverListener } from '../../common/update/auto-update.types';
import { createSimulatedUpdateDriver } from './simulated-update-driver';

const message = (error: unknown) => error instanceof Error ? error.message : String(error);

/**
 * electron-updater against GitHub Releases. The feed (owner/repo) comes from the `publish` block of
 * electron-builder.yml, baked into app-update.yml; macOS needs a signed build for the swap to succeed.
 */
function createElectronUpdaterDriver(listener: UpdateDriverListener): UpdateDriver {
    // Lazy getter: the platform updater is only created here, never in dev runs.
    const updater = electronUpdater.autoUpdater;
    updater.autoDownload = true;
    updater.autoInstallOnAppQuit = true;
    updater.on('checking-for-update', () => listener.onChecking());
    updater.on('update-available', info => listener.onAvailable(info.version));
    updater.on('update-not-available', () => listener.onNotAvailable());
    updater.on('download-progress', progress => listener.onProgress(progress.percent));
    updater.on('update-downloaded', info => listener.onDownloaded(info.version));
    updater.on('error', error => listener.onError(message(error)));
    return {
        async check(allowPrerelease: boolean): Promise<void> {
            updater.allowPrerelease = allowPrerelease;
            await updater.checkForUpdates();
        },
        // Silent install (no NSIS wizard) and relaunch the app afterwards.
        quitAndInstall: () => updater.quitAndInstall(true, true)
    };
}

export function createUpdateDriver(listener: UpdateDriverListener, decision: AutoUpdateDecision): UpdateDriver {
    return decision.simulatedVersion
        ? createSimulatedUpdateDriver(listener, app.getVersion(), decision.simulatedVersion, () => app.quit())
        : createElectronUpdaterDriver(listener);
}
