import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { launchDesktop, nativeEdit, readClipboard, writeClipboard, writeClipboardImage, type DesktopApp } from '../src/electron.utils';
import { composerPlainText } from '../src/composer.e2e-utils';

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
const chips = (page: Page) => page.locator('#ingot-composer-input .ingot-chip-code');

const openModels = async (page: Page): Promise<void> => {
    const file = page.locator('#explorer-view-container .theia-TreeNode', { hasText: 'models.ts' }).first();
    await expect(async () => {
        if (!await file.isVisible()) {
            await page.locator('#explorer-view-container .theia-TreeNode', { hasText: /^src$/ }).first().click({ timeout: 2_000 });
        }
        await file.dblclick({ timeout: 2_000 });
        const editor = page.locator('#theia-main-content-panel .monaco-editor').first();
        await expect(editor).toBeVisible({ timeout: 2_000 });
        // The editor sometimes opens scrolled to its last line; go to the top so lines 3-5 are on screen.
        await editor.click({ position: { x: 60, y: 10 } });
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowUp' : 'Control+Home');
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
    await expect.poll(() => composerPlainText(page)).toBe('');
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
        await expect.poll(() => composerPlainText(page)).toBe('from a web page\nsecond line');
        await expect(chips(page)).toHaveCount(0);
    });

    test('two chips with text between stay in order, in the composer and in the sent message (IDEA-98)', async () => {
        const { app, page } = desktop;
        await selectPickModel(page);
        await page.keyboard.press(`${MOD}+c`);
        await expect.poll(() => readClipboard(app)).toContain('await page.click(id);');
        await focusComposer(page);
        await page.keyboard.press(`${MOD}+v`);
        await expect(chips(page)).toHaveCount(1);
        await page.keyboard.type('my text here ');

        // Second range: lines 4-5.
        await page.locator('.monaco-editor .view-line', { hasText: 'await page.click(id);' }).first().click();
        await page.keyboard.press('Home');
        await page.keyboard.press('Shift+ArrowDown');
        await page.keyboard.press('Shift+End');
        await page.keyboard.press(`${MOD}+c`);
        await expect.poll(() => readClipboard(app)).toMatch(/await page\.click\(id\);\n\};/);
        await composer(page).click();
        // The paste must land in the composer, not the editor the copy came from.
        await expect(composer(page)).toBeFocused();
        // Caret to the end of the composer (⌘↓ on macOS, Ctrl+End elsewhere).
        await page.keyboard.press(process.platform === 'darwin' ? 'Meta+ArrowDown' : 'Control+End');
        await page.keyboard.press(`${MOD}+v`);
        await expect(chips(page)).toHaveCount(2);
        await page.keyboard.type('more text');

        const order = await composer(page).evaluate(el => Array.from(el.childNodes)
            .map(n => n instanceof HTMLElement && n.dataset.chipId ? `[${n.querySelector('.ingot-chip-label')?.textContent}]` : (n.textContent ?? '').replace(/\u00a0/g, ' ').trim())
            .filter(Boolean).join(' '));
        expect(order).toBe('[models.ts (3-5)] my text here [models.ts (4-5)] more text');

        // Backspace right after a chip removes it whole; arrow keys step over chips.
        if (process.env.SHOTS_DIR) {
            await page.screenshot({ path: path.join(process.env.SHOTS_DIR, 'electron-inline-chips.png') });
        }
        await page.keyboard.press('Enter');
        const sent = page.locator('.ingot-chat-user .ingot-chat-parts').last();
        await expect(sent).toBeVisible();
        await expect(sent).toHaveText(/models\.ts \(3-5\)\s*my text here\s*models\.ts \(4-5\)\s*more text/);
        await expect(sent.locator('.ingot-chip-code')).toHaveCount(2);
    });

    test('Backspace removes a chip whole (IDEA-98)', async () => {
        const { app, page } = desktop;
        await selectPickModel(page);
        await page.keyboard.press(`${MOD}+c`);
        await expect.poll(() => readClipboard(app)).toContain('await page.click(id);');
        await focusComposer(page);
        await page.keyboard.press(`${MOD}+v`);
        await expect(chips(page)).toHaveCount(1);
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        await expect(chips(page)).toHaveCount(0);
    });

    test('pasting an image makes a thumbnail chip that enlarges and removes (IDEA-98)', async () => {
        const { app, page } = desktop;
        await focusComposer(page);
        await page.keyboard.type('what is this ');
        await writeClipboardImage(app);
        await page.keyboard.press(`${MOD}+v`);
        const image = page.locator('#ingot-composer-input .ingot-chip-image');
        await expect(image).toHaveCount(1);
        await expect(image.locator('img.ingot-chip-thumb')).toHaveAttribute('src', /^data:image\/png;base64,/);
        await image.locator('.ingot-chip-label').click();
        await expect(page.locator('#ingot-lightbox img')).toBeVisible();
        if (process.env.SHOTS_DIR) {
            await page.screenshot({ path: path.join(process.env.SHOTS_DIR, 'electron-image-lightbox.png') });
        }
        await page.locator('#ingot-lightbox').click();
        await expect(page.locator('#ingot-lightbox')).toHaveCount(0);
        await image.locator('.ingot-chip-remove').click();
        await expect(image).toHaveCount(0);
        await expect.poll(() => composerPlainText(page)).toBe('what is this');
    });
});
