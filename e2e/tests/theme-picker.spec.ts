import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, openIngot } from '../src/app.utils';
import { shot } from '../src/agent-tools.e2e-utils';
import { CONFIG_PROJECT } from '../src/e2e.consts';
import { FAKE_THEME, mockOpenVsx } from '../src/fake-open-vsx';

const settings = (page: Page) => page.locator('#ingot-settings');
const picker = (page: Page) => page.locator('#ingot-theme-picker');
const row = (page: Page, label: string) => picker(page).locator('.ingot-theme-row', { hasText: label }).first();
const body = (page: Page) => page.locator('body');

const openSettings = async (page: Page): Promise<void> => {
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), settings(page));
};
const setMode = async (page: Page, mode: 'system' | 'light' | 'dark'): Promise<void> => {
    await openSettings(page);
    await page.locator('#ingot-setting-ingot-appearance').selectOption(mode);
    await page.locator('#ingot-settings-ok').click();
    await expect(settings(page)).toBeHidden();
};
const openPicker = async (page: Page): Promise<void> => {
    await openSettings(page);
    await page.locator('#ingot-settings-action-pickTheme').click();
    await expect(picker(page)).toBeVisible();
};

test.describe('IDEA-144 theme picker', () => {
    test.beforeEach(async ({ page }) => {
        await page.emulateMedia({ colorScheme: 'dark' });
        await openIngot(page, CONFIG_PROJECT);
        await setMode(page, 'system');
        await expect(body(page)).toHaveClass(/ingot-dark/);
    });

    test('hover previews live, Esc reverts and keeps Settings open', async ({ page }) => {
        await openPicker(page);
        await expect(picker(page).locator('#ingot-theme-group-light')).toContainText('Ingot Light');
        await expect(picker(page).locator('#ingot-theme-group-dark')).toContainText('Ingot Ember');
        await expect(page.locator('#ingot-theme-slot-dark')).toHaveAttribute('aria-selected', 'true');
        await row(page, 'Ingot Ember').hover();
        await expect(body(page)).toHaveClass(/ingot-ember/);
        await shot(page, 'theme-picker-dark.png');
        // Arrow keys preview too; search narrows the list.
        await page.locator('#ingot-theme-picker-search').fill('ingot');
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('Escape');
        await expect(picker(page)).toBeHidden();
        await expect(body(page)).toHaveClass(/ingot-dark/);
        await expect(body(page)).not.toHaveClass(/ingot-ember/);
        await expect(settings(page)).toBeVisible();
        await page.locator('#ingot-settings-cancel').click();
    });

    test('Apply sets the System Dark theme; System Light keeps its own', async ({ page }) => {
        await openPicker(page);
        await row(page, 'Ingot Ember').click();
        await page.locator('#ingot-theme-picker-apply').click();
        await expect(picker(page)).toBeHidden();
        await expect(body(page)).toHaveClass(/ingot-ember/);
        await expect(page.locator('#ingot-setting-ingot-appearance-darkTheme')).toHaveValue('ingot-ember');
        await page.locator('#ingot-settings-cancel').click();
        // The OS switches to light: System Light theme; back to dark: the picked one.
        await page.emulateMedia({ colorScheme: 'light' });
        await expect(body(page)).toHaveClass(/ingot-light/);
        await openPicker(page);
        await expect(page.locator('#ingot-theme-slot-light')).toHaveAttribute('aria-selected', 'true');
        await shot(page, 'theme-picker-light.png');
        await page.locator('#ingot-theme-picker-cancel').click();
        await page.locator('#ingot-settings-cancel').click();
        await page.emulateMedia({ colorScheme: 'dark' });
        await expect(body(page)).toHaveClass(/ingot-ember/);
        // Restore the default dark slot.
        await openPicker(page);
        await row(page, 'Ingot Dark').click();
        await page.locator('#ingot-theme-picker-apply').click();
        await expect(body(page)).toHaveClass(/ingot-dark/);
        await page.locator('#ingot-settings-cancel').click();
    });

    test('browses Open VSX, installs a theme, previews it and uninstalls it (mocked store)', async ({ page }) => {
        const store = await mockOpenVsx(page);
        await openPicker(page);
        await page.locator('#ingot-theme-browse').click();
        const card = page.locator(`.ingot-theme-card[data-extension-id="${FAKE_THEME.id}"]`);
        await expect(card).toBeVisible();
        await expect(card).toContainText(FAKE_THEME.displayName);
        await expect(card).toContainText('12K');
        await expect(card).toContainText('4.6');
        // Icon-only packs are not color themes.
        await expect(page.locator('.ingot-theme-card[data-extension-id="acme.acme-icons"]')).toHaveCount(0);
        await card.hover();
        await expect(card.locator('.ingot-theme-swatch')).toBeVisible();
        await shot(page, 'theme-picker-browse-dark.png');
        await card.locator('.ingot-theme-install').click();
        // Install, then preview: back on the list with the new theme applied live.
        await expect(row(page, FAKE_THEME.themeLabel)).toHaveAttribute('aria-selected', 'true');
        await expect(body(page)).toHaveClass(new RegExp(FAKE_THEME.themeId));
        await expect.poll(() => page.evaluate(() => getComputedStyle(document.body).getPropertyValue('--theia-editor-background').trim().toLowerCase())).toBe(FAKE_THEME.background);
        expect(store.downloads()).toBe(1);
        // Cancel reverts the preview but the theme stays installed.
        await page.keyboard.press('Escape');
        await expect(body(page)).toHaveClass(/ingot-dark/);
        await page.locator('#ingot-settings-cancel').click();
        await openPicker(page);
        await row(page, FAKE_THEME.themeLabel).hover();
        await expect(body(page)).toHaveClass(new RegExp(FAKE_THEME.themeId));
        await row(page, FAKE_THEME.themeLabel).locator('.ingot-theme-uninstall').click();
        await expect(row(page, FAKE_THEME.themeLabel)).toHaveCount(0);
        await expect(body(page)).toHaveClass(/ingot-dark/);
        await page.locator('#ingot-theme-picker-cancel').click();
        await page.locator('#ingot-settings-cancel').click();
    });
});
