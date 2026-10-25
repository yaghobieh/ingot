import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { launchDesktop, nativeEdit, readClipboard, writeClipboard, type DesktopApp } from '../src/electron.utils';

/**
 * IDEA-65 in the real desktop app: lines copied from an editor paste into the composer as a chip. The desktop copy/paste
 * commands bypass DOM clipboard events, so both routes are covered: ⌘C/⌘V keybindings and the Edit-menu roles.
 */
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';
const makeProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-paste-')));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'models.ts'), ['import { Page } from "x";', '', 'export const pickModel = async (page: Page, id: string): Promise<void> => {', '    await page.click(id);', '};', ''].join('\n'));
    return dir;
};

const composer = (page: Page) => page.locator('#ingot-composer-input');
const chips = (page: Page) => page.locator('#ingot-composer-chips .ingot-chip-code');

const openModels = async (page: Page): Promise<void> => {
    const file = page.locator('#explorer-view-container .theia-TreeNode', { hasText: 'models.ts' }).first();
    await expect(async () => {
        if (!await file.isVisible()) {
            await page.locator('#explorer-view-container .theia-TreeNode', { hasText: /^src$/ }).first().click({ timeout: 2_000 });
        }
        await file.dblclick({ timeout: 2_000 });
        await expect(page.locator('.monaco-editor .view-line', { hasText: 'export const pickModel' }).first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 60_000 });
};

/** Selects lines 3-5 (pickModel) in the editor. */
const selectPickModel = async (page: Page): Promise<void> => {
    await page.locator('.monaco-editor .view-line', { hasText: 'export const pickModel' }).first().click();
    await page.keyboard.press('Home');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+ArrowDown');
    await page.keyboard.press('Shift+End');
};

const focusComposer = async (page: Page): Promise<void> => {
    if (!await composer(page).isVisible()) {
        await page.locator('#ingot-rs-agents').click();
    }
    await composer(page).click();
};

const expectChip = async (page: Page): Promise<void> => {
    await expect(chips(page)).toHaveCount(1);
    await expect(chips(page).locator('.ingot-chip-label')).toHaveText('models.ts (3-5)');
    await expect(composer(page)).toHaveValue('');
};

const clearChips = async (page: Page): Promise<void> => {
    while (await chips(page).count()) {
        await chips(page).first().hover();
        await chips(page).first().locator('.ingot-chip-remove').click();
    }
};

test.describe('IDEA-65 desktop paste → chip', () => {
    let dir: string;
    let desktop: DesktopApp;
    let saved = '';
    test.beforeEach(async () => {
        dir = makeProject();
        desktop = await launchDesktop(dir);
        saved = await readClipboard(desktop.app);
        await openModels(desktop.page);
    });
    test.afterEach(async () => {
        if (desktop) {
            await writeClipboard(desktop.app, saved).catch(() => undefined);
            await desktop.close();
        }
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('⌘C in the editor, ⌘V in the composer makes a chip (keybinding route)', async () => {
        const { app, page } = desktop;
        await selectPickModel(page);
        await page.keyboard.press(`${MOD}+c`);
        await expect.poll(() => readClipboard(app)).toContain('await page.click(id);');
        await focusComposer(page);
        await page.keyboard.press(`${MOD}+v`);
        await expectChip(page);
        if (process.env.SHOTS_DIR) {
            await chips(page).hover();
            await page.waitForTimeout(300);
            await page.screenshot({ path: path.join(process.env.SHOTS_DIR, 'electron-paste-chip.png') });
        }
    });

    // The editor's right-click Copy runs the same `core.copy` command as ⌘C (covered above); the desktop context menu is
    // native, so Playwright cannot click it.
    test('Edit > Copy / Paste roles make a chip; outside text stays text', async () => {
        const { app, page } = desktop;
        await selectPickModel(page);
        await nativeEdit(app, 'copy');
        await expect.poll(() => readClipboard(app)).toContain('await page.click(id);');
        await focusComposer(page);
        await nativeEdit(app, 'paste');
        await expectChip(page);
        await clearChips(page);

        // Text copied outside the editor pastes as plain text.
        await writeClipboard(app, 'from a web page\nsecond line');
        await composer(page).click();
        await page.keyboard.press(`${MOD}+v`);
        await expect(composer(page)).toHaveValue('from a web page\nsecond line');
        await expect(chips(page)).toHaveCount(0);
    });
});
