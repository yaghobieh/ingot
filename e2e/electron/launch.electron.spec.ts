import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type ElectronApplication, type Page } from '@playwright/test';
import { APP_READY_TIMEOUT_MS, SHELL_SELECTOR } from '../src/e2e.consts';
import { launchDesktop, makeDesktopProfile, startElectron } from '../src/electron.utils';

/**
 * Launch without a splash: the desktop app opens one plain window in the saved theme background (no logo, gradient or
 * card) and fades into the workbench when it is ready. The Rex </> glyph in the main toolbar has no tile behind it.
 */
const SHOTS_DIR = process.env.INGOT_SHOTS_DIR;
const LAUNCH_BACKGROUND_KEY = 'ingot.launch.background';
const MAX_FADE_S = 0.3;
const TRANSPARENT = 'rgba(0, 0, 0, 0)';
const HEX_RGB = 6;
const POLL_MS = 25;

/** `rgb(43, 45, 48)` → `#2B2D30`, as Electron reports window background colors. */
const toHex = (rgb: string): string => `#${(rgb.match(/\d+/g) ?? []).slice(0, 3).map(n => Number(n).toString(16).padStart(2, '0')).join('')}`.toUpperCase();
const sameColor = (electronHex: string, cssRgb: string): boolean => electronHex.toUpperCase().slice(-HEX_RGB) === toHex(cssRgb).slice(1);

const windowBackgrounds = (app: ElectronApplication): Promise<string[]> =>
    app.evaluate(({ BrowserWindow }) => BrowserWindow.getAllWindows().map(w => w.getBackgroundColor()));

const shot = async (page: Page, name: string): Promise<void> => {
    if (SHOTS_DIR) {
        fs.mkdirSync(SHOTS_DIR, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS_DIR, name) });
    }
};

for (const appearance of ['dark', 'light'] as const) {
    test.describe(`plain launch window (${appearance})`, () => {
        let dir: string;
        let profile: string;
        let app: ElectronApplication | undefined;

        test.beforeEach(() => {
            dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-launch-')));
            profile = makeDesktopProfile({ 'ingot.appearance': appearance });
        });

        test.afterEach(async () => {
            await app?.close().catch(() => undefined);
            fs.rmSync(dir, { recursive: true, force: true });
            fs.rmSync(profile, { recursive: true, force: true });
        });

        test('opens in the saved theme background, without a splash, and fades into the workbench', async () => {
            test.setTimeout(APP_READY_TIMEOUT_MS * 2);

            // First run: the workbench remembers its canvas color for the next launch, in the page and on the native window.
            const first = await launchDesktop(dir, {}, {}, profile);
            await expect(first.page.locator('body')).toHaveClass(new RegExp(`ingot-${appearance}`));
            const canvas = await first.page.locator('body').evaluate(el => getComputedStyle(el).backgroundColor);
            expect(canvas).not.toBe(TRANSPARENT);
            await expect.poll(() => first.page.evaluate(key => localStorage.getItem(key), LAUNCH_BACKGROUND_KEY)).toBe(canvas);
            await expect.poll(async () => (await windowBackgrounds(first.app)).every(bg => sameColor(bg, canvas))).toBe(true);

            // The Rex </> glyph in the toolbar sits on a transparent background (no tile).
            const logo = first.page.locator('.ingot-tb-logo');
            await expect(logo.locator('svg.ingot-rex-mark')).toBeVisible();
            await expect(logo).toHaveCSS('background-color', TRANSPARENT);
            await expect(logo.locator('svg.ingot-rex-mark rect')).toHaveCount(0);
            await first.close();

            // Second run: one window only (no splash), already in the saved color, with an empty overlay that fades out.
            app = await startElectron(dir, profile);
            const page = await app.firstWindow();
            const windows = await windowBackgrounds(app);
            expect(windows).toHaveLength(1);
            expect(sameColor(windows[0], canvas)).toBe(true);

            const overlay = page.locator('.theia-preload');
            await expect(overlay).toBeAttached({ timeout: APP_READY_TIMEOUT_MS });
            // While loading, the overlay is opaque and painted in the saved color: a plain window, nothing on it.
            // Read it in one go: on a fast start it is removed right after the fade.
            const readOverlay = () => overlay.evaluate(el => {
                const style = getComputedStyle(el);
                return !el.isConnected || style.opacity !== '1' ? undefined : {
                    background: style.backgroundColor,
                    children: Array.from(el.children, c => c.tagName),
                    text: Array.from(el.childNodes, n => n.nodeName === 'STYLE' ? '' : n.textContent ?? '').join('').trim(),
                    after: getComputedStyle(el, '::after').content,
                    image: style.backgroundImage,
                    fade: parseFloat(style.transitionDuration)
                };
            }).catch(() => undefined);
            let look: Awaited<ReturnType<typeof readOverlay>>;
            await expect.poll(async () => (look = await readOverlay())?.background, { intervals: [POLL_MS] }).toBe(canvas);
            await shot(page, `launch-plain-${appearance}.png`);
            if (!look) {
                throw new Error('launch overlay was not seen');
            }
            expect(look.children.every(tag => tag === 'STYLE')).toBe(true);
            expect(look.text).toBe('');
            expect(look.after).toBe('none');
            expect(look.image).toBe('none');
            expect(look.fade).toBeGreaterThan(0);
            expect(look.fade).toBeLessThanOrEqual(MAX_FADE_S);

            await expect(page.locator(SHELL_SELECTOR)).toBeVisible({ timeout: APP_READY_TIMEOUT_MS });
            await expect(overlay).toHaveCount(0, { timeout: APP_READY_TIMEOUT_MS });
            expect(await windowBackgrounds(app)).toHaveLength(1);
            expect(app.windows()).toHaveLength(1);
            await expect(page.locator('body')).toHaveCSS('background-color', canvas);
            await shot(page, `launch-ready-${appearance}.png`);
        });
    });
}
