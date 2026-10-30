import { app } from '@theia/core/electron-shared/electron';
import { inject, injectable } from '@theia/core/shared/inversify';
import type { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { IngotUpdateController } from './update/ingot-update-controller';

/** Starts the update schedule once Electron is ready (IDEA-134, IDEA-269). Packaged builds only. */
@injectable()
export class IngotAutoUpdateContribution implements ElectronMainApplicationContribution {

    @inject(IngotUpdateController) protected readonly controller: IngotUpdateController;

    onStart(): void {
        if (!this.controller.enabled) {
            console.info(`[ingot] auto-update off (${this.controller.decision.reason})`);
            return;
        }
        app.whenReady().then(() => this.controller.start());
    }

    onStop(): void {
        this.controller.dispose();
    }
}
