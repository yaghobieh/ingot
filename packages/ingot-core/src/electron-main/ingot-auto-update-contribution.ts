import { app } from '@theia/core/electron-shared/electron';
import * as electronUpdater from 'electron-updater';
import { injectable } from '@theia/core/shared/inversify';
import type { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { AUTO_UPDATE_FIRST_CHECK_MS, AUTO_UPDATE_INTERVAL_MS } from '../common/update/auto-update.consts';
import { autoUpdateDecision } from '../common/update/auto-update.utils';

/**
 * Auto-update from GitHub Releases via electron-updater (IDEA-134). Packaged builds only; the feed
 * (owner/repo) comes from the `publish` block of electron-builder.yml, baked into app-update.yml.
 * Downloads in the background and installs on quit; the OS notification tells the user a restart applies it.
 * macOS needs a signed build for the swap to succeed; unsigned beta builds just log the error.
 */
@injectable()
export class IngotAutoUpdateContribution implements ElectronMainApplicationContribution {

    protected timer: ReturnType<typeof setInterval> | undefined;

    onStart(): void {
        const decision = autoUpdateDecision({ isPackaged: app.isPackaged, platform: process.platform, version: app.getVersion(), env: process.env });
        if (!decision.enabled) {
            console.info(`[ingot] auto-update off (${decision.reason})`);
            return;
        }
        app.whenReady().then(() => setTimeout(() => this.start(decision.allowPrerelease), AUTO_UPDATE_FIRST_CHECK_MS));
    }

    onStop(): void {
        if (this.timer) {
            clearInterval(this.timer);
        }
    }

    protected start(allowPrerelease: boolean): void {
        let updater: electronUpdater.AppUpdater;
        try {
            // Lazy getter: the platform updater is only created here, never in dev runs.
            updater = electronUpdater.autoUpdater;
        } catch (error) {
            console.warn('[ingot] auto-update unavailable', error instanceof Error ? error.message : error);
            return;
        }
        updater.allowPrerelease = allowPrerelease;
        updater.autoDownload = true;
        updater.autoInstallOnAppQuit = true;
        updater.on('error', error => console.warn('[ingot] auto-update error', error?.message ?? error));
        updater.on('update-downloaded', info => console.info(`[ingot] update ${info.version} downloaded; installs on quit`));
        const check = () => updater.checkForUpdatesAndNotify().catch(error => console.warn('[ingot] update check failed', error?.message ?? error));
        check();
        this.timer = setInterval(check, AUTO_UPDATE_INTERVAL_MS);
    }
}
