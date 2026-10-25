import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, openIngot } from '../src/app.utils';

// Playwright's Desktop Chrome reports Windows, so Settings is Ctrl+Alt+S.
const dialog = (page: Page) => page.locator('#ingot-settings');
const node = (page: Page, id: string) => page.locator(`#ingot-settings-node-${id}`);
const openSettings = async (page: Page): Promise<void> => {
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), dialog(page));
};

test.describe('IDEA-34 Settings dialog', () => {
    test('Ctrl+Alt+S opens a searchable tree; Apply, OK and Cancel behave like IntelliJ', async ({ page }) => {
        await openIngot(page);
        await openSettings(page);
        await expect(page.locator('#ingot-settings-crumbs')).toHaveText('Appearance & Behavior › Appearance');
        await expect(page.locator('#ingot-setting-workbench-colorTheme option', { hasText: 'Ingot Darcula' })).toHaveCount(1);
        await expect(page.locator('#ingot-settings-apply')).toBeDisabled();

        // Search narrows the tree to Editor › Font and the matching setting.
        await page.locator('#ingot-settings-search').fill('font size');
        await expect(node(page, 'editor-font')).toBeVisible();
        await expect(node(page, 'keymap')).toHaveCount(0);
        await node(page, 'editor-font').click();
        await expect(page.locator('#ingot-settings-crumbs')).toHaveText('Editor › Font');
        const fontSize = page.locator('#ingot-setting-editor-fontSize');
        await fontSize.fill('17');
        await expect(page.locator('.ingot-setting.modified[data-key="editor.fontSize"]')).toBeVisible();
        await page.locator('#ingot-settings-apply').click();
        await expect(page.locator('#ingot-settings-apply')).toBeDisabled();
        await expect(page.locator('.ingot-setting.modified')).toHaveCount(0);

        // Cancel drops unapplied edits.
        await page.locator('#ingot-settings-search').fill('');
        await node(page, 'editor-general').click();
        const minimap = page.locator('#ingot-setting-editor-minimap-enabled');
        const before = await minimap.isChecked();
        await minimap.click();
        await page.locator('#ingot-settings-cancel').click();
        await expect(dialog(page)).toBeHidden();
        await openSettings(page);
        await node(page, 'editor-general').click();
        await expect(page.locator('#ingot-setting-editor-minimap-enabled')).toBeChecked({ checked: before });
        await node(page, 'editor-font').click();
        await expect(page.locator('#ingot-setting-editor-fontSize')).toHaveValue('17');
        await page.locator('#ingot-setting-editor-fontSize').fill('14');
        await page.keyboard.press('Enter'); // Enter = OK
        await expect(dialog(page)).toBeHidden();
    });

    test('theme switches on OK and page buttons open the keymap editor', async ({ page }) => {
        await openIngot(page);
        await page.locator('#ingot-tb-settings').click();
        await expect(dialog(page)).toBeVisible();
        await page.locator('#ingot-setting-workbench-colorTheme').selectOption({ label: 'Ingot Light' });
        await page.locator('#ingot-settings-ok').click();
        await expect(page.locator('body')).toHaveClass(/theia-light/);
        await expect(dialog(page)).toBeHidden();

        await openSettings(page);
        await page.locator('#ingot-setting-workbench-colorTheme').selectOption({ label: 'Ingot Dark' });
        await expect(page.locator('.ingot-setting.modified[data-key="workbench.colorTheme"]')).toBeVisible();
        await page.locator('#ingot-settings-apply').click();
        await expect(page.locator('body')).toHaveClass(/theia-dark/);
        await node(page, 'keymap').click();
        await expect(page.locator('#ingot-setting-ingot-keymap')).toHaveValue('IntelliJ IDEA');
        await page.locator('#ingot-settings-action-openKeymap').click();
        await expect(dialog(page)).toBeHidden();
        await expect(page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: 'Keyboard Shortcuts' })).toBeVisible();
    });
});
