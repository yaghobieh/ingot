import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, openIngot, quickInput, quickOptions } from '../src/app.utils';

// Playwright's Desktop Chrome reports Windows, so Settings is Ctrl+Alt+S.
const dialog = (page: Page) => page.locator('#ingot-settings');
const node = (page: Page, id: string) => page.locator(`#ingot-settings-node-${id}`);
const openSettings = async (page: Page): Promise<void> => {
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), dialog(page));
};

test.describe('IDEA-34 Settings dialog', () => {
    test('Ctrl+Alt+S opens a searchable tree; Apply, OK and Cancel behave like classic IDEs', async ({ page }) => {
        await openIngot(page);
        await openSettings(page);
        await expect(page.locator('#ingot-settings-crumbs')).toHaveText('Appearance & Behavior › Appearance');
        await expect(page.locator('#ingot-setting-workbench-colorTheme option', { hasText: 'Ingot Ember' })).toHaveCount(1);
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
        await openSettings(page);
        await page.locator('#ingot-setting-ingot-appearance').selectOption('light');
        await page.locator('#ingot-settings-ok').click();
        await expect(page.locator('body')).toHaveClass(/theia-light/);
        await expect(dialog(page)).toBeHidden();

        await openSettings(page);
        await page.locator('#ingot-setting-ingot-appearance').selectOption('dark');
        await expect(page.locator('.ingot-setting.modified[data-key="ingot.appearance"]')).toBeVisible();
        await page.locator('#ingot-settings-apply').click();
        await expect(page.locator('body')).toHaveClass(/theia-dark/);
        await page.locator('#ingot-setting-ingot-appearance').selectOption('system');
        await page.locator('#ingot-settings-apply').click();
        await node(page, 'keymap').click();
        await expect(page.locator('#ingot-setting-ingot-keymap')).toHaveValue('Ingot (default)');
        await page.locator('#ingot-settings-action-openKeymap').click();
        await expect(dialog(page)).toBeHidden();
        await expect(page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: 'Keyboard Shortcuts' })).toBeVisible();
    });
});

test.describe('IDEA-35 Light / Dark / System theme', () => {
    test('System follows the OS live; the toolbar and status bar pick Light or Dark', async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'light' });
        await openIngot(page);
        const status = page.locator('#theia-statusBar [id$="ingot-appearance"]');
        const pick = async (label: string) => {
            await page.locator('#ingot-rs-theme').click();
            await page.locator('.quick-input-widget .monaco-list-row', { hasText: label }).first().click();
        };
        await pick('System');
        await expect(status).toContainText('System');
        await expect(page.locator('body')).toHaveClass(/ingot-light/);
        await page.emulateMedia({ colorScheme: 'dark' });
        await expect(page.locator('body')).toHaveClass(/ingot-dark/);
        await page.emulateMedia({ colorScheme: 'light' });
        await expect(page.locator('body')).toHaveClass(/ingot-light/);

        await pick('Dark');
        await expect(status).toContainText('Dark');
        await expect(page.locator('body')).toHaveClass(/ingot-dark/);
        await status.click();
        await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'Light' }).first().click();
        await expect(page.locator('body')).toHaveClass(/ingot-light/);

        // Picking a specific color theme in Settings switches the mode to Custom theme.
        await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), dialog(page));
        await page.locator('#ingot-setting-workbench-colorTheme').selectOption({ label: 'Ingot Ember' });
        await page.locator('#ingot-settings-ok').click();
        await expect(page.locator('body')).toHaveClass(/ingot-ember/);
        await expect(status).toContainText('Custom theme');
        await pick('System');
        await expect(page.locator('body')).toHaveClass(/ingot-light/);
    });

    test('generic Open Settings entry points open Ingot Settings, never the legacy list', async ({ page }) => {
        await openIngot(page);
        await page.keyboard.press('F1');
        await expect(quickInput(page)).toBeVisible();
        await quickInput(page).fill('>Open Settings (UI)');
        await quickOptions(page).first().click();
        await expect(dialog(page)).toBeVisible();
        await expect(page.locator('#settings_widget')).toHaveCount(0);
    });
});
