import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { APP_READY_TIMEOUT_MS, E2E_KEYCHAIN_SERVICE, E2E_USER_SETTINGS, FAKE_INGOT_URL, IMPORT_HOME, SHELL_SELECTOR } from './e2e.consts';

const ROOT = path.resolve(__dirname, '..', '..');
export const ELECTRON_APP_DIR = path.join(ROOT, 'applications', 'electron');

export interface DesktopApp {
    readonly app: ElectronApplication;
    readonly page: Page;
    close(): Promise<void>;
}

/** The layout the specs are written for (CSS px). */
const MIN_VIEWPORT = { width: 1440, height: 900 } as const;
const CLOSE_TIMEOUT_MS = 20_000;

/**
 * IDEA-189: a new window is 2/3 of the screen, and the CI macOS runner's screen is small (1024×768), so the window was
 * about 680×510: the editor area got squeezed (no visible lines, overlapping review-bar buttons). Fill the screen's work
 * area and, when that is still smaller than the layout the specs expect, zoom out so the page gets at least that viewport.
 * On a normal developer screen the zoom stays at 1.
 */
const fitWindow = async (app: ElectronApplication, page: Page): Promise<void> => {
    const win = await app.browserWindow(page);
    await app.evaluate(({ screen }, { w, min }) => {
        const { workArea } = screen.getDisplayMatching(w.getBounds());
        w.setBounds(workArea);
        const [width, height] = w.getContentSize();
        w.webContents.setZoomFactor(Math.min(1, width / min.width, height / min.height));
    }, { w: win, min: MIN_VIEWPORT });
    await expect.poll(() => page.evaluate(() => window.innerWidth), { timeout: 10_000 }).toBeGreaterThanOrEqual(MIN_VIEWPORT.width - 2);
};

/** Closes the app, and kills it if it does not quit in time, so a hung quit cannot eat the test and worker timeouts. */
const closeApp = async (app: ElectronApplication): Promise<void> => {
    const closed = app.close().then(() => true, () => true);
    const done = await Promise.race([closed, new Promise<boolean>(resolve => setTimeout(() => resolve(false), CLOSE_TIMEOUT_MS))]);
    if (!done) {
        app.process().kill('SIGKILL');
    }
};

/** Launches the desktop app on `workspace` with an isolated config dir, Electron profile and keychain service. */
export const launchDesktop = async (workspace: string, extraEnv: Record<string, string> = {}, settings: Record<string, unknown> = {}): Promise<DesktopApp> => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-electron-e2e-'));
    fs.mkdirSync(path.join(profile, 'config'), { recursive: true });
    fs.writeFileSync(path.join(profile, 'config', 'settings.json'), JSON.stringify({ ...E2E_USER_SETTINGS, ...settings }));
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
            INGOT_WORKSPACE: workspace,
            // Never the developer's local ingot-server: account specs start the fake one on this URL.
            INGOT_SERVER_URL: FAKE_INGOT_URL,
            INGOT_PORTAL_URL: FAKE_INGOT_URL,
            INGOT_NO_PROTOCOL_CLIENT: '1',
            ...extraEnv
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
    await fitWindow(app, page!);
    return {
        app, page,
        close: async () => {
            await closeApp(app);
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
