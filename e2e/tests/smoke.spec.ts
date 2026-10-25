import { expect, test } from '@playwright/test';
import { openIngot, runCommand } from '../src/app.utils';

test.describe('IDEA-40 starter app', () => {
    test('boots the Ingot workbench on a workspace', async ({ page }) => {
        await openIngot(page);
        await expect(page).toHaveTitle(/Ingot/);
        await expect(page.locator('#theia-main-content-panel')).toBeVisible();
    });

    test('shows About Ingot from the Help menu command', async ({ page }) => {
        await openIngot(page);
        await runCommand(page, 'About Ingot');
        await expect(page.locator('.theia-notification-message', { hasText: 'Ingot 0.1.0' }).first()).toBeVisible();
    });
});
