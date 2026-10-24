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
        await expect(header.locator('.ingot-about-logo svg.ingot-mark')).toBeVisible();
        // IDEA-55: the About dialog shows the app icon (rounded square with the gold ingot).
        expect(await header.locator('.ingot-about-logo').evaluate(el => getComputedStyle(el).backgroundImage)).toContain('Ingot%20app%20icon');
        await page.locator('.dialogBlock').getByRole('button', { name: 'OK' }).click();
        await expect(header).toBeHidden();
    });
});
