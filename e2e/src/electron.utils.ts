import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { _electron as electron, expect, type ElectronApplication, type Page } from '@playwright/test';
import { APP_CLOSE_TIMEOUT_MS, APP_READY_TIMEOUT_MS, E2E_KEYCHAIN_SERVICE, E2E_USER_SETTINGS, FAKE_INGOT_URL, FAKE_OPENROUTER_URL, IMPORT_HOME, MOCK_KEYCHAIN_ARG, SHELL_SELECTOR } from './e2e.consts';

const ROOT = path.resolve(__dirname, '..', '..');
export const ELECTRON_APP_DIR = path.join(ROOT, 'applications', 'electron');

export interface DesktopApp {
    readonly app: ElectronApplication;
    readonly page: Page;
    close(): Promise<void>;
}

/** A throwaway config dir + Electron profile; pass it to several launches to test what the app remembers between them. */
export const makeDesktopProfile = (settings: Record<string, unknown> = {}): string => {
    const profile = fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-electron-e2e-'));
    fs.mkdirSync(path.join(profile, 'config'), { recursive: true });
    fs.writeFileSync(path.join(profile, 'config', 'settings.json'), JSON.stringify({ ...E2E_USER_SETTINGS, ...settings }));
    return profile;
};

/**
 * Starts Electron on `workspace` with the profile's config dir and Electron data, an isolated keychain service and a
 * file key store; `--use-mock-keychain` keeps Chromium off the macOS keychain too. Does not wait for the workbench.
 */
export const startElectron = (workspace: string, profile: string, extraEnv: Record<string, string> = {}): Promise<ElectronApplication> => {
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const executablePath = require(path.join(ROOT, 'node_modules', 'electron')) as unknown as string;
    return electron.launch({
        executablePath,
        // Playwright adds its own switches before the app path, which shifts Theia's argv parsing so the app folder would be
        // taken as the workspace. A leading `--ingot-e2e` switch makes the app path its value; Chromium ignores it.
        args: ['--ingot-e2e', ELECTRON_APP_DIR, MOCK_KEYCHAIN_ARG, `--user-data-dir=${path.join(profile, 'electron')}`, workspace],
        cwd: workspace,
        env: {
            ...process.env,
            THEIA_CONFIG_DIR: path.join(profile, 'config'),
            INGOT_KEYCHAIN_SERVICE: E2E_KEYCHAIN_SERVICE,
            INGOT_DEV_FILE_KEYSTORE: path.join(profile, 'config', 'keystore.json'),
            INGOT_IMPORT_HOME: IMPORT_HOME,
            INGOT_WORKSPACE: workspace,
            // Never the developer's local ingot-server: account specs start the fake one on this URL.
            INGOT_SERVER_URL: FAKE_INGOT_URL,
            INGOT_PORTAL_URL: FAKE_INGOT_URL,
            INGOT_OPENROUTER_BASE_URL: FAKE_OPENROUTER_URL,
            OPENROUTER_API_KEY: '',
            INGOT_NO_PROTOCOL_CLIENT: '1',
            ...extraEnv
        },
        timeout: APP_READY_TIMEOUT_MS
    });
};

/**
 * Launches the desktop app on `workspace` and waits for the workbench. Without a `shared` profile it gets a fresh one
 * that is removed on close; a shared profile is kept (the caller removes it).
 */
export const launchDesktop = async (workspace: string, extraEnv: Record<string, string> = {}, settings: Record<string, unknown> = {}, shared?: string): Promise<DesktopApp> => {
    const profile = shared ?? makeDesktopProfile(settings);
    const app = await startElectron(workspace, profile, extraEnv);
    // The first window can be a reloading frame: wait for the one that hosts the workbench.
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
            // A failed test can leave a prompt (unsaved changes) that blocks quitting: kill the app after a while.
            const closed = app.close().catch(() => undefined);
            const timedOut = new Promise<'timeout'>(resolve => setTimeout(() => resolve('timeout'), APP_CLOSE_TIMEOUT_MS));
            if (await Promise.race([closed, timedOut]) === 'timeout') {
                app.process().kill('SIGKILL');
            }
            if (!shared) {
                fs.rmSync(profile, { recursive: true, force: true });
            }
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
