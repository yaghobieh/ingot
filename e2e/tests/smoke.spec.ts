import { expect, test } from '@playwright/test';
import { openIngot, runCommand } from '../src/app.utils';

test.describe('IDEA-40 starter app', () => {
    test('boots the Ingot workbench on a workspace', async ({ page }) => {
        await openIngot(page);
        await expect(page).toHaveTitle(/Ingot/);
        await expect(page.locator('#theia-main-content-panel')).toBeVisible();
    });

    test('shows the branded About Ingot dialog', async ({ page }) => {
        await openIngot(page);
        await runCommand(page, 'About Ingot');
        const header = page.locator('.ingot-about-header');
        await expect(header).toBeVisible();
        await expect(header).toContainText('Ingot');
        await expect(header).toContainText('0.1.0');
        await expect(header.locator('.ingot-about-logo')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(header).toBeHidden();
    });
});
