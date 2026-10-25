import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';

/** IDEA-67 taller, resizable composer and IDEA-65 context chips, clicked through. */
const makeProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-composer-')));
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.writeFileSync(path.join(dir, 'scripts', 'dev-db.mjs'), ['const a = 1;', 'const b = 2;', 'const c = 3;', 'export { a, b, c };', ''].join('\n'));
    return dir;
};

const node = (page: Page, name: string) =>
    page.locator('#explorer-view-container .theia-TreeNode').filter({ has: page.locator('.theia-TreeNodeSegmentGrow').getByText(name, { exact: true }) }).first();
const composer = (page: Page) => page.locator('#ingot-composer-input');
const openAgents = async (page: Page): Promise<void> => {
    if (!await composer(page).isVisible()) {
        await page.locator('#ingot-rs-agents').click();
    }
    await expect(composer(page)).toBeVisible();
};
const paste = (page: Page, text: string) => composer(page).evaluate((el, t) => {
    const data = new DataTransfer();
    data.setData('text/plain', t);
    el.dispatchEvent(new ClipboardEvent('paste', { clipboardData: data, bubbles: true, cancelable: true }));
}, text);

test.describe('IDEA-65 / IDEA-67 agent composer', () => {
    test.use({ permissions: ['clipboard-read', 'clipboard-write'] });
    let dir: string;
    test.beforeEach(() => { dir = makeProject(); });
    test.afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    test('composer is compact (2 lines, per reference), grows to half the panel and resizes by drag', async ({ page }) => {
        await openIngot(page, dir);
        await dismissNotifications(page);
        await openAgents(page);
        const box = async () => (await composer(page).boundingBox())!.height;
        expect(await box()).toBeGreaterThanOrEqual(36);
        expect(await box()).toBeLessThan(60);

        await composer(page).fill(Array.from({ length: 80 }, (_, i) => `line ${i}`).join('\n'));
        const panel = (await page.locator('#ingot-agents').boundingBox())!.height;
        await expect.poll(box).toBeGreaterThan(200);
        expect(await box()).toBeLessThanOrEqual(panel * 0.5 + 2);

        await composer(page).fill('');
        await expect.poll(box).toBeLessThan(100);
        const handle = (await page.locator('#ingot-composer-resize').boundingBox())!;
        await page.mouse.move(handle.x + handle.width / 2, handle.y + 4);
        await page.mouse.down();
        await page.mouse.move(handle.x + handle.width / 2, handle.y - 120, { steps: 5 });
        await page.mouse.up();
        await expect.poll(box).toBeGreaterThan(140);

        // Shift+Enter inserts a newline instead of sending.
        await composer(page).fill('first');
        await composer(page).press('Shift+Enter');
        await composer(page).type('second');
        await expect(composer(page)).toHaveValue('first\nsecond');
    });

    test('editor paste and Add to Chat make chips; outside text pastes as text', async ({ page }) => {
        await openIngot(page, dir);
        await dismissNotifications(page);
        await expect(node(page, 'scripts')).toBeVisible({ timeout: 30_000 });
        await expect(async () => {
            await page.keyboard.press('Escape');
            await page.keyboard.press('Control+p');
            await page.locator('.quick-input-widget input').fill('dev-db.mjs');
            await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'dev-db.mjs' }).first().click({ timeout: 3_000 });
            await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('const b', { timeout: 3_000 });
        }).toPass({ timeout: 40_000 });

        // Select lines 2-3 and copy them.
        await page.locator('.monaco-editor .view-line', { hasText: 'const b' }).first().click();
        await page.keyboard.press('Home');
        await page.keyboard.press('Shift+ArrowDown');
        await page.keyboard.press('Shift+ArrowDown');
        await page.keyboard.press('Control+c');
        const copied = await page.evaluate(() => navigator.clipboard.readText());
        expect(copied).toContain('const c');

        await openAgents(page);
        await paste(page, copied);
        const chip = page.locator('#ingot-composer-chips .ingot-chip-code');
        await expect(chip).toHaveCount(1);
        await expect(chip.locator('.ingot-chip-label')).toHaveText('dev-db.mjs (2-3)');
        await expect(composer(page)).toHaveValue('');
        await chip.hover();
        await expect(chip.locator('.ingot-chip-preview')).toBeVisible();
        await expect(chip.locator('.ingot-chip-preview pre')).toContainText('const b = 2;');

        // Outside multi-line text stays text.
        await paste(page, 'from a web page\nsecond line');
        await expect(chip).toHaveCount(1);

        // Click opens the file at the lines; ✕ removes the chip.
        await chip.locator('.ingot-chip-label').click();
        await expect(page.locator('.lm-TabBar-tab.lm-mod-current', { hasText: 'dev-db.mjs' }).first()).toBeVisible();
        await chip.locator('.ingot-chip-remove').click();
        await expect(chip).toHaveCount(0);

        // Add to Chat (⌘L / Ctrl+L) from the editor selection.
        await page.locator('.monaco-editor .view-line', { hasText: 'const a' }).first().click();
        await page.keyboard.press('Home');
        await page.keyboard.press('Shift+ArrowDown');
        await page.keyboard.press('Shift+End');
        await page.keyboard.press('Control+l');
        await expect(chip.locator('.ingot-chip-label')).toHaveText('dev-db.mjs (1-2)');
    });
});
