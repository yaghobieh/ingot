import { SIMULATED_PROGRESS_STEPS, SIMULATED_STEP_MS } from '../../common/update/auto-update.consts';
import { compareVersions } from '../../common/config/remote-config.utils';
import type { UpdateDriver, UpdateDriverListener } from '../../common/update/auto-update.types';

const step = () => new Promise(resolve => setTimeout(resolve, SIMULATED_STEP_MS));

/**
 * Dev/e2e stand-in for electron-updater (INGOT_UPDATE_SIMULATE=<version>, unpackaged builds only): "publishes"
 * that version, walks through the download events, and quits the app on install. No network, no installer.
 */
export function createSimulatedUpdateDriver(listener: UpdateDriverListener, currentVersion: string, publishedVersion: string, quit: () => void): UpdateDriver {
    return {
        async check(): Promise<void> {
            listener.onChecking();
            await step();
            if (compareVersions(currentVersion, publishedVersion) >= 0) {
                listener.onNotAvailable();
                return;
            }
            listener.onAvailable(publishedVersion);
            // Like electron-updater, the check resolves while the download goes on in the background.
            void (async () => {
                for (const percent of SIMULATED_PROGRESS_STEPS) {
                    await step();
                    listener.onProgress(percent);
                }
                listener.onDownloaded(publishedVersion);
            })();
        },
        quitAndInstall: quit
    };
}
