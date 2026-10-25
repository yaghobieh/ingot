import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test } from '@playwright/test';
import { ELECTRON_APP_DIR, launchDesktop, type DesktopApp } from '../src/electron.utils';

/** IDEA-108: the desktop app is called Ingot everywhere on macOS and uses the transparent </> icon. */
test.describe('IDEA-108 app name and icon (desktop)', () => {
    let dir: string;
    let desktop: DesktopApp;
    test.beforeEach(async () => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-brand-')));
        desktop = await launchDesktop(dir);
    });
    test.afterEach(async () => {
        await desktop?.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('runs as Ingot from Ingot.app, with a transparent Dock icon', async () => {
        const { app } = desktop;
        const info = await app.evaluate(({ app: a }) => ({ name: a.getName(), exe: process.execPath }));
        expect(info.name).toBe('Ingot');
        if (process.platform === 'darwin') {
            expect(info.exe).toContain('/Ingot.app/Contents/MacOS/');
            const plist = fs.readFileSync(path.join(info.exe, '..', '..', 'Info.plist'), 'utf8');
            for (const key of ['CFBundleName', 'CFBundleDisplayName']) {
                expect(plist).toMatch(new RegExp(`<key>${key}</key>\\s*<string>Ingot</string>`));
            }
            expect(plist).toMatch(/<key>CFBundleIdentifier<\/key>\s*<string>dev\.ingot\.preview<\/string>/);
        }
        // The bundled main process finds the icon next to it, and its corners are transparent (no tile).
        const icon = path.join(ELECTRON_APP_DIR, 'resources', 'app-icon.png');
        expect(fs.existsSync(icon)).toBe(true);
        const corner = await app.evaluate(({ nativeImage }, file) => {
            const image = nativeImage.createFromPath(file);
            const { width } = image.getSize();
            const bitmap = image.toBitmap();
            return { empty: image.isEmpty(), width, alpha: bitmap[3], mid: bitmap[(Math.floor(width / 2) * width + Math.floor(width / 2)) * 4 + 3] };
        }, icon);
        expect(corner.empty).toBe(false);
        expect(corner.width).toBeGreaterThanOrEqual(512);
        expect(corner.alpha).toBe(0);
        expect(fs.readdirSync(path.join(ELECTRON_APP_DIR, 'resources', 'dock-anim')).filter(f => f.endsWith('.png')).length).toBeGreaterThan(10);
    });
});
