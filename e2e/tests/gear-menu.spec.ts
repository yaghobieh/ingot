import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';

const menuItem = (page: Page, label: string) => page.locator('.lm-Menu .lm-Menu-item', { has: page.locator('.lm-Menu-itemLabel', { hasText: new RegExp(`^${label}$`) }) });
const openGear = async (page: Page): Promise<void> => {
    await page.locator('#ingot-stripe-settings').click();
    await expect(menuItem(page, 'Settings…')).toBeVisible();
};

/** IDEA-117: the bottom-left gear opens a Manage menu instead of jumping straight to Settings. */
test.describe('IDEA-117 gear menu', () => {
    test('lists Settings, Theme, Extensions, MCP, Keymap, Memories and Check for Updates', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        await openGear(page);
        for (const label of ['Theme', 'Extensions', 'MCP Servers', 'Rules & Commands', 'Models & API Keys', 'Keymap', 'Keyboard Shortcuts', 'Memories', 'Check for Updates…', 'About Ingot']) {
            await expect(menuItem(page, label)).toBeVisible();
        }
        // The menu opens beside the gear at the bottom-left.
        const gear = (await page.locator('#ingot-stripe-settings').boundingBox())!;
        const menu = (await page.locator('.lm-Menu').first().boundingBox())!;
        expect(menu.x).toBeGreaterThanOrEqual(gear.x + gear.width - 2);

        await menuItem(page, 'Settings…').click();
        await expect(page.locator('#ingot-settings')).toBeVisible();
        await page.locator('#ingot-settings-cancel').click();
    });

    test('Theme submenu switches Light / Dark / System with a ✓ on the current one', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        // Earlier specs may leave any theme on; walk Dark → Light → System and check the ✓ follows.
        await openGear(page);
        await menuItem(page, 'Theme').hover();
        await menuItem(page, 'Dark').click();
        await expect(page.locator('body')).toHaveClass(/theia-dark/);

        await openGear(page);
        await menuItem(page, 'Theme').hover();
        await expect(menuItem(page, 'Dark')).toHaveClass(/lm-mod-toggled/);
        await expect(menuItem(page, 'Light')).not.toHaveClass(/lm-mod-toggled/);
        await menuItem(page, 'Light').click();
        await expect(page.locator('body')).toHaveClass(/theia-light/);

        // Back to the default, System.
        await openGear(page);
        await menuItem(page, 'Theme').hover();
        await expect(menuItem(page, 'Light')).toHaveClass(/lm-mod-toggled/);
        await menuItem(page, 'System').click();
        await openGear(page);
        await menuItem(page, 'Theme').hover();
        await expect(menuItem(page, 'System')).toHaveClass(/lm-mod-toggled/);
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
    });

    test('Memories and Keymap open their pages; Check for Updates answers honestly', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        await page.route('https://api.github.com/repos/yaghobieh/ingot/releases/latest', route => route.fulfill({ status: 404, body: '{}' }));
        await openGear(page);
        await menuItem(page, 'Keymap').click();
        await expect(page.locator('#ingot-settings')).toBeVisible();
        await expect(page.locator('#ingot-setting-ingot-keymap')).toBeVisible();
        await page.locator('#ingot-settings-cancel').click();

        await openGear(page);
        await menuItem(page, 'Memories').click();
        await expect(page.locator('.ingot-memories')).toBeVisible();

        await openGear(page);
        await menuItem(page, 'Check for Updates…').click();
        await expect(page.locator('.theia-notification-list-item', { hasText: 'No release has been published yet' })).toBeVisible();
        await dismissNotifications(page);
    });
});
