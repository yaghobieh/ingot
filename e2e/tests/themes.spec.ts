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
    test('imports a VS Code color theme from a file, applies it, and removes it', async ({ page }) => {
        await openIngot(page, CONFIG_PROJECT);
        await openSettings(page);
        await expect(themeSelect(page).locator('option', { hasText: 'High Contrast' }).first()).toBeAttached();
        await page.locator('#ingot-settings-action-importTheme').click();

        // Theia file dialog: expand themes/, pick the file, Import.
        const fileDialog = page.locator('.dialogBlock', { hasText: 'Import VS Code Color Theme' });
        await expect(fileDialog).toBeVisible();
        await fileDialog.locator('.theia-TreeNode', { hasText: 'themes' }).dblclick();
        await fileDialog.locator('.theia-TreeNode', { hasText: 'sample-night-color-theme.json' }).click();
        await fileDialog.getByRole('button', { name: 'Import' }).click();

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
    });
});
