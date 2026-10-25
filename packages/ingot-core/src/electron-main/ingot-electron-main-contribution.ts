import * as fs from 'fs';
import * as path from 'path';
import { execFile } from 'child_process';
import { app, nativeImage, type BrowserWindow } from '@theia/core/electron-shared/electron';
import { injectable } from '@theia/core/shared/inversify';
import type { ElectronMainApplicationContribution } from '@theia/core/lib/electron-main/electron-main-application';
import { PRODUCT } from '../common/product.consts';

/**
 * The @ingot/core resources folder (IDEA-108). In the bundled app the main process runs from
 * applications/electron/lib/backend, so `__dirname/../../resources` is the app's own copy (esbuild.mjs puts it there);
 * the @ingot/core package (tsc output or the monorepo source) is the fallback.
 */
const resourcesDir = (): string => {
    const candidates = [path.resolve(__dirname, '..', '..', 'resources')];
    try {
        candidates.push(path.join(path.dirname(require.resolve('@ingot/core/package.json')), 'resources'));
    } catch {
        // Not resolvable from a bundle; the other candidates cover it.
    }
    candidates.push(path.resolve(__dirname, '..', '..', '..', '..', 'packages', 'ingot-core', 'resources'));
    return candidates.find(dir => fs.existsSync(path.join(dir, 'app-icon.png'))) ?? candidates[0];
};
const RESOURCES_DIR = resourcesDir();
/** Packaged with @ingot/core so dev runs and builds both show the Ingot icon. */
export const APP_ICON_PATH = path.join(RESOURCES_DIR, 'app-icon.png');
/** Launch animation frames of the </> mark (scripts/build-icon-v3.mjs). */
export const DOCK_ANIMATION_DIR = path.join(RESOURCES_DIR, 'dock-anim');
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
