import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { shot } from '../src/agent-tools.e2e-utils';
import { E2E_BASE_URL, E2E_CONFIG_DIR, FIXTURE_WORKSPACE } from '../src/e2e.consts';

/** IDEA-281: theme and layout survive a reload and opening files leaves the chat alone (Cursor import: cursor-import.spec.ts). */
const SETTINGS_FILE = path.join(E2E_CONFIG_DIR, 'settings.json');
const LAYOUT_SAVE_WAIT_MS = 1_500;

const readSettings = (): Record<string, unknown> => {
    try {
        return JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) as Record<string, unknown>;
    } catch {
        return {};
    }
};
const writeSettings = (patch: Record<string, unknown>): void =>
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...readSettings(), ...patch }, undefined, 4));

const appearanceStatus = (page: Page): Locator => page.locator('#status-bar-ingot-appearance');
const themeKind = (page: Page): Promise<string | null> => page.evaluate(() => document.documentElement.getAttribute('data-theme'));
const pickAppearance = async (page: Page, mode: 'dark' | 'system', label: string): Promise<void> => {
    const dialog = page.locator('#ingot-settings');
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), dialog);
    await page.locator('#ingot-settings-node-appearance').click();
    await page.locator('#ingot-setting-ingot-appearance').selectOption(mode);
    await page.locator('#ingot-settings-ok').click();
    await expect(dialog).toBeHidden();
    await expect(appearanceStatus(page)).toContainText(label);
};

const node = (page: Page, name: string): Locator =>
    page.locator('#explorer-view-container .theia-TreeNode').filter({ has: page.locator('.theia-TreeNodeSegmentGrow').getByText(name, { exact: true }) }).first();
const expandSrc = (page: Page): Promise<void> => actUntilVisible(() => node(page, 'src').click(), node(page, 'app.ts'));
const menuItem = async (page: Page, target: Locator, label: string): Promise<void> => {
    const menu = page.locator('.lm-Menu').first();
    await actUntilVisible(async () => {
        if (await menu.isVisible()) {
            await page.keyboard.press('Escape');
        }
        await target.click({ button: 'right' });
    }, menu);
    await menu.locator('.lm-Menu-item', { has: page.locator('.lm-Menu-itemLabel', { hasText: new RegExp(`^${label}$`) }) }).first().click();
};
const mainTab = (page: Page, name: string): Locator => page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: name });
const agents = (page: Page): Locator => page.locator('#ingot-agents');
const composer = (page: Page): Locator => page.locator('#ingot-composer-input');
const focusInChat = (page: Page): Promise<boolean> =>
    page.evaluate(() => !!document.activeElement && !!document.querySelector('#ingot-agents')?.contains(document.activeElement));

const tempProject = (prefix: string): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'app.ts'), 'export const app = 1;\n');
    fs.writeFileSync(path.join(dir, 'src', 'math.ts'), 'export const add = (a: number, b: number): number => a + b;\n');
    return dir;
};

test.describe('IDEA-281 state and workspace behavior', () => {
    test('theme mode and color theme persist in user settings and paint before the shell', async ({ page }) => {
        await openIngot(page);
        try {
            await pickAppearance(page, 'dark', 'Dark');
            await expect.poll(() => themeKind(page)).toBe('dark');
            await expect.poll(() => readSettings()['ingot.appearance']).toBe('dark');
            await expect.poll(() => readSettings()['workbench.colorTheme']).toBe('ingot-dark');

            // Browser storage gone (new profile, new version): the settings file alone brings Dark back.
            await page.evaluate(() => localStorage.clear());
            await openIngot(page);
            await expect(appearanceStatus(page)).toContainText('Dark');
            expect(await themeKind(page)).toBe('dark');
            await shot(page, 'ide-b-theme-dark-after-reload.png');

            // The preload screen already knows the theme before any script bundle runs.
            await page.goto('about:blank');
            await page.goto(`${E2E_BASE_URL}/#${FIXTURE_WORKSPACE}`, { waitUntil: 'domcontentloaded' });
            expect(await page.evaluate(() => document.documentElement.getAttribute('data-ingot-boot'))).toBe('dark');
            await openIngot(page);

            // System is a choice too, and stays System (not Custom) after a reload.
            await pickAppearance(page, 'system', 'System');
            await expect.poll(() => readSettings()['ingot.appearance']).toBe('system');
            await openIngot(page);
            await expect(appearanceStatus(page)).toContainText('System');
            await expect.poll(() => themeKind(page)).toBe('light');
            await shot(page, 'ide-b-theme-system-light.png');
        } finally {
            writeSettings({ 'ingot.appearance': 'system' });
        }
    });

    test('open editors and the chat panel visibility come back after a reload', async ({ page }) => {
        const dir = tempProject('ingot-layout-');
        try {
            await openIngot(page, dir);
            await dismissNotifications(page);
            await expandSrc(page);
            await node(page, 'app.ts').dblclick();
            await expect(mainTab(page, 'app.ts')).toBeVisible();
            await expect(agents(page)).toBeVisible();
            await page.locator('#ingot-rs-agents').click();
            await expect(agents(page)).toBeHidden();

            // Saved right after the change, not only on a clean unload (a crash or update restart keeps it too).
            await page.waitForTimeout(LAYOUT_SAVE_WAIT_MS);
            const saved = await page.evaluate(() => Object.keys(localStorage).filter(k => k.endsWith(':layout')).map(k => localStorage.getItem(k) ?? '').join('\n'));
            expect(saved).toContain('app.ts');

            await openIngot(page, dir);
            await expect(mainTab(page, 'app.ts')).toBeVisible();
            await expect(agents(page)).toBeHidden();
            await shot(page, 'ide-b-layout-restored-chat-hidden.png');

            await page.locator('#ingot-rs-agents').click();
            await expect(agents(page)).toBeVisible();
            await page.waitForTimeout(LAYOUT_SAVE_WAIT_MS);
            await openIngot(page, dir);
            await expect(agents(page)).toBeVisible();
            await expect(mainTab(page, 'app.ts')).toBeVisible();
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('opening files never focuses the chat or attaches them; Add File to Agent Chat does', async ({ page }) => {
        const dir = tempProject('ingot-open-');
        try {
            await openIngot(page, dir);
            await dismissNotifications(page);
            await composer(page).click();
            await page.keyboard.type('draft');
            await expandSrc(page);
            await node(page, 'app.ts').click();
            await expect(mainTab(page, 'app.ts')).toBeVisible();
            await node(page, 'math.ts').dblclick();
            await expect(mainTab(page, 'math.ts')).toBeVisible();
            expect(await focusInChat(page)).toBe(false);

            // New File from the explorer opens the new file in the editor, not in the chat.
            await menuItem(page, node(page, 'src'), 'New File…');
            const dialog = page.locator('.dialogBlock').filter({ hasText: 'New File' });
            await dialog.locator('input.theia-input').fill('fresh.ts');
            await dialog.getByRole('button', { name: 'OK' }).click();
            await expect(mainTab(page, 'fresh.ts')).toBeVisible();
            expect(await focusInChat(page)).toBe(false);

            await expect(composer(page)).toHaveText('draft');
            await expect(composer(page).locator('[data-chip-id]')).toHaveCount(0);
            await shot(page, 'ide-b-open-file-chat-untouched.png');

            // Only the explicit action adds the file.
            await menuItem(page, node(page, 'app.ts'), 'Add File to Agent Chat');
            await expect(composer(page)).toHaveText(/@src\/app\.ts/);
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
