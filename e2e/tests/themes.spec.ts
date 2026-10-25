import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, openIngot, runCommand } from '../src/app.utils';
import { CONFIG_PROJECT } from '../src/e2e.consts';

const dialog = (page: Page) => page.locator('#ingot-settings');
const openSettings = async (page: Page): Promise<void> => {
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), dialog(page));
};
const themeSelect = (page: Page) => page.locator('#ingot-setting-workbench-colorTheme');
const iconSelect = (page: Page) => page.locator('#ingot-setting-workbench-iconTheme');
const editorBackground = (page: Page) => page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--theia-editor-background').trim().toLowerCase());

test.describe('IDEA-35/36 color themes and icon themes', () => {
    test('imports a color theme from a file, applies it, and removes it', async ({ page }) => {
        await openIngot(page, CONFIG_PROJECT);
        await openSettings(page);
        await expect(themeSelect(page).locator('option', { hasText: 'High Contrast' }).first()).toBeAttached();
        await page.locator('#ingot-settings-action-importTheme').click();

        // Theia file dialog: expand themes/, pick the file, Import.
        const fileDialog = page.locator('.dialogBlock').filter({ has: page.getByText('Import Color Theme', { exact: true }) });
        await expect(fileDialog).toBeVisible();
        await fileDialog.locator('.theia-TreeNode', { hasText: 'themes' }).dblclick();
        await fileDialog.locator('.theia-TreeNode', { hasText: 'sample-night-color-theme.json' }).click();
        await fileDialog.getByRole('button', { name: 'Import', exact: true }).click();

        await expect(page.locator('body')).toHaveClass(/user-sample-night/);
        await expect.poll(() => editorBackground(page)).toBe('#011627');
        await expect(dialog(page)).toBeVisible();
        await expect(themeSelect(page)).toHaveValue('user-sample-night');
        await expect(themeSelect(page).locator('option', { hasText: 'Sample Night (imported)' })).toHaveCount(1);
        await page.locator('#ingot-settings-cancel').click();

        // Imported themes survive a reload.
        await openIngot(page, CONFIG_PROJECT);
        await expect(page.locator('body')).toHaveClass(/user-sample-night/);

        await runCommand(page, 'Remove Imported Color Theme');
        const row = page.locator('.quick-input-widget .monaco-list-row', { hasText: 'Sample Night' });
        await row.click();
        await expect(page.locator('body')).not.toHaveClass(/user-sample-night/);
    });

    test('IDEA-106: Ingot Files is the default icon theme - colour icons in the tree and tabs, in light and dark', async ({ page }) => {
        // The shipped default (other tests change the e2e profile's choice, so pick it here as well).
        const appConfig = JSON.parse(fs.readFileSync(path.resolve(__dirname, '..', '..', 'applications', 'browser', 'package.json'), 'utf8'));
        expect(appConfig.theia.frontend.config.preferences['workbench.iconTheme']).toBe('ingot-files');
        await openIngot(page, CONFIG_PROJECT);
        await page.locator('#files').click();
        await openSettings(page);
        await iconSelect(page).selectOption({ label: 'Ingot Files' });
        await page.locator('#ingot-settings-ok').click();
        const tree = page.locator('#files');
        const node = (name: string) => tree.locator('.theia-TreeNode', { hasText: name }).first();
        await expect(node('AGENTS.md').locator('.ingot-ficon-robot')).toBeVisible();
        await expect(node('package.json').locator('.ingot-ficon-nodejs')).toBeVisible();
        await expect(node('src').locator('.ingot-ficon-folder-src')).toBeVisible();
        await expect(node('themes').locator('.ingot-ficon-folder')).toBeVisible();
        // A real SVG image, not a font glyph or an empty box.
        const image = await node('AGENTS.md').locator('.ingot-ficon').evaluate(el => getComputedStyle(el).backgroundImage);
        expect(image).toContain('data:image/svg+xml');
        // Tabs use the same icons.
        await node('src').click();
        await tree.locator('.theia-TreeNode', { hasText: 'index.ts' }).dblclick();
        await expect(page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: 'index.ts' }).locator('.ingot-ficon-typescript')).toBeVisible();
        const tabIcon = page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: 'index.ts' }).locator('.ingot-ficon');
        expect(await tabIcon.evaluate(el => getComputedStyle(el).backgroundImage)).toContain('data:image/svg+xml');
        for (const mode of ['light', 'dark']) {
            await openSettings(page);
            await page.locator('#ingot-setting-ingot-appearance').selectOption(mode);
            await page.locator('#ingot-settings-ok').click();
            await expect(dialog(page)).toBeHidden();
            await expect(node('AGENTS.md').locator('.ingot-ficon-robot')).toBeVisible();
            if (process.env.SHOTS_DIR) {
                await page.waitForTimeout(400);
                await page.screenshot({ path: `${process.env.SHOTS_DIR}/file-icons-${mode}.png` });
            }
        }
    });

    test('Ingot icon theme colors files in the project tree', async ({ page }) => {
        await openIngot(page, CONFIG_PROJECT);
        await page.locator('#files').click();
        await openSettings(page);
        await iconSelect(page).selectOption({ label: 'Ingot Icons' });
        await page.locator('#ingot-settings-ok').click();
        const tree = page.locator('#files');
        await expect(tree.locator('.theia-TreeNode', { hasText: 'AGENTS.md' }).locator('.ingot-fi-agent')).toBeVisible();
        await expect(tree.locator('.theia-TreeNode', { hasText: 'themes' }).locator('.ingot-fi')).toBeVisible();

        await openSettings(page);
        await iconSelect(page).selectOption({ label: 'File Icons (Theia)' });
        await page.locator('#ingot-settings-ok').click();
        await expect(tree.locator('.ingot-fi')).toHaveCount(0);

        // Default Ingot Badges: TS/{ }/AI text badges on files, no folder icons.
        await openSettings(page);
        await iconSelect(page).selectOption({ label: 'Ingot Badges' });
        await page.locator('#ingot-settings-ok').click();
        await expect(tree.locator('.theia-TreeNode', { hasText: 'AGENTS.md' }).locator('.ingot-fbadge-agent')).toBeVisible();
        await expect(tree.locator('.theia-TreeNode', { hasText: 'themes' }).locator('.ingot-fbadge-none')).toBeHidden();
        await expect(tree.locator('.theia-TreeNode', { hasText: 'themes' }).locator('.ingot-fbadge-none')).toHaveCount(1);
        const badge = await tree.locator('.theia-TreeNode', { hasText: 'AGENTS.md' }).locator('.ingot-fbadge').evaluate(el => getComputedStyle(el, '::before').content);
        expect(badge).toBe('"AI"');
    });
});
