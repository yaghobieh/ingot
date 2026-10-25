import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { app, nativeImage, type BrowserWindow } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import type { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { PRODUCT } from '../common/product.consts';

/** Packaged with @ingot/core so dev runs and builds both show the Ingot icon. */
export const APP_ICON_PATH = path.resolve(__dirname, '..', '..', 'resources', 'app-icon.png');
/** Launch animation frames of the </> mark (scripts/build-icon-v3.mjs). */
export const DOCK_ANIMATION_DIR = path.resolve(__dirname, '..', '..', 'resources', 'dock-anim');
const DOCK_FRAME_MS = 50;

/** macOS "Reduce motion" (System Settings › Accessibility › Display). */
const prefersReducedMotion = (): Promise<boolean> => new Promise(resolve => {
    execFile('defaults', ['read', 'com.apple.universalaccess', 'reduceMotion'], { timeout: 1000 }, (error, stdout) => resolve(!error && stdout.trim() === '1'));
});

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
            this.animateDock(icon);
        } else {
            app.on('browser-window-created', (_event: unknown, window: BrowserWindow) => window.setIcon(icon));
        }
    }

    /** Plays the </> mark animation in the Dock once on launch (~1.5 s), then settles on the static icon. */
    protected async animateDock(finalIcon: Electron.NativeImage): Promise<void> {
        if (process.env.INGOT_NO_DOCK_ANIMATION || await prefersReducedMotion()) {
            return;
        }
        const frames = fs.existsSync(DOCK_ANIMATION_DIR)
            ? fs.readdirSync(DOCK_ANIMATION_DIR).filter(f => f.endsWith('.png')).sort().map(f => nativeImage.createFromPath(path.join(DOCK_ANIMATION_DIR, f))).filter(i => !i.isEmpty())
            : [];
        for (const frame of frames) {
            app.dock?.setIcon(frame);
            await new Promise(resolve => setTimeout(resolve, DOCK_FRAME_MS));
        }
        app.dock?.setIcon(finalIcon);
    }
}
