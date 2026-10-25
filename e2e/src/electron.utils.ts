import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { APP_READY_TIMEOUT_MS, E2E_KEYCHAIN_SERVICE, IMPORT_HOME, SHELL_SELECTOR } from './e2e.consts';

const ROOT = path.resolve(__dirname, '..', '..');
export const ELECTRON_APP_DIR = path.join(ROOT, 'applications', 'electron');

export interface DesktopApp {
    readonly app: ElectronApplication;
    readonly page: Page;
    close(): Promise<void>;
}

/** Launches the desktop app on `workspace` with an isolated config dir, Electron profile and keychain service. */
export const launchDesktop = async (workspace: string): Promise<DesktopApp> => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-electron-e2e-'));
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const executablePath = require(path.join(ROOT, 'node_modules', 'electron')) as unknown as string;
    const app = await electron.launch({
        executablePath,
        // Playwright adds its own switches before the app path, which shifts Theia's argv parsing so the app folder would be
        // taken as the workspace. A leading `--ingot-e2e` switch makes the app path its value; Chromium ignores it.
        args: ['--ingot-e2e', ELECTRON_APP_DIR, `--user-data-dir=${path.join(profile, 'electron')}`, workspace],
        cwd: workspace,
        env: {
            ...process.env,
            THEIA_CONFIG_DIR: path.join(profile, 'config'),
            INGOT_KEYCHAIN_SERVICE: E2E_KEYCHAIN_SERVICE,
            INGOT_IMPORT_HOME: IMPORT_HOME,
            INGOT_WORKSPACE: workspace
        },
        timeout: APP_READY_TIMEOUT_MS
    });
    // The first window can be a splash or a reloading frame: wait for the one that hosts the workbench.
    let page: Page | undefined;
    await expect.poll(async () => {
        for (const w of app.windows()) {
            if (!w.isClosed() && await w.locator(SHELL_SELECTOR).isVisible().catch(() => false)) {
                page = w;
            }
        }
        return !!page;
    }, { timeout: APP_READY_TIMEOUT_MS, intervals: [500] }).toBe(true);
    if (!page) {
        throw new Error('Ingot window did not open');
    }
    await expect(page!.locator('.theia-preload')).toHaveCount(0, { timeout: APP_READY_TIMEOUT_MS });
    return {
        app, page,
        close: async () => {
            await app.close().catch(() => undefined);
            fs.rmSync(profile, { recursive: true, force: true });
        }
    };
};

/** Native Edit-menu roles, exactly what ⌘C / ⌘V from the application menu run. */
export const nativeEdit = (app: ElectronApplication, role: 'copy' | 'cut' | 'paste'): Promise<void> =>
    app.evaluate(({ BrowserWindow }, r) => {
        const win = BrowserWindow.getFocusedWindow() ?? BrowserWindow.getAllWindows()[0];
        win.webContents[r]();
    }, role);

export const readClipboard = (app: ElectronApplication): Promise<string> => app.evaluate(({ clipboard }) => clipboard.readText());
export const writeClipboard = (app: ElectronApplication, text: string): Promise<void> => app.evaluate(({ clipboard }, t) => clipboard.writeText(t), text);

/** Puts a small PNG (an 8×8 red square, base64) on the native clipboard (IDEA-98 image paste). */
export const RED_PNG = 'iVBORw0KGgoAAAANSUhEUgAAAAgAAAAICAIAAABLbSncAAAAEUlEQVR4nGN46uGLFTEMLQkAEvNegaK5qlEAAAAASUVORK5CYII=';
export const writeClipboardImage = (app: ElectronApplication, base64Png: string = RED_PNG): Promise<void> =>
    app.evaluate(({ clipboard, nativeImage }, data) => clipboard.writeImage(nativeImage.createFromDataURL(`data:image/png;base64,${data}`)), base64Png);
