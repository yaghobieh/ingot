import * as path from 'path';
import { app, nativeImage, type BrowserWindow } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import type { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { PRODUCT } from '../common/product.consts';

/** Packaged with @ingot/core so dev runs and builds both show the Ingot icon. */
export const APP_ICON_PATH = path.resolve(__dirname, '..', '..', 'resources', 'app-icon.png');

/** Desktop branding: Ingot name and icon in the Dock / taskbar / windows (IDEA-54). */
@injectable()
export class IngotElectronMainContribution implements ElectronMainApplicationContribution {

    onStart(): void {
        app.setName(PRODUCT.name);
        const icon = nativeImage.createFromPath(APP_ICON_PATH);
        if (icon.isEmpty()) {
            return;
        }
        if (process.platform === 'darwin') {
            app.dock?.setIcon(icon);
        } else {
            app.on('browser-window-created', (_event: unknown, window: BrowserWindow) => window.setIcon(icon));
        }
    }
}
