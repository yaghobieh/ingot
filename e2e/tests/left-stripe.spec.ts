import { expect, test } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';

/** IDEA-92: left stripe without count badges; Account and Settings at the bottom-left. */
test.describe('IDEA-92 left stripe', () => {
    test('no badge half-circles; Account menu and Settings sit at the bottom-left', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        const badges = page.locator('.lm-TabBar.theia-app-left .theia-badge-decorator-sidebar');
        for (let i = 0; i < await badges.count(); i++) {
            await expect(badges.nth(i)).toBeHidden();
        }
        const account = page.locator('#ingot-stripe-account');
        const settings = page.locator('#ingot-stripe-settings');
        await expect(account).toBeVisible();
        await expect(settings).toBeVisible();
        const viewport = page.viewportSize()!;
        const a = (await account.boundingBox())!;
        const s = (await settings.boundingBox())!;
        expect(a.x).toBeLessThan(50);
        expect(s.y).toBeGreaterThan(a.y);
        expect(s.y + s.height).toBeGreaterThan(viewport.height - 90);

        await account.click();
        await page.locator('.lm-Menu .lm-Menu-itemLabel', { hasText: 'Sign in to Ingot…' }).click();
        await expect(page.locator('.theia-notification-message', { hasText: 'Ingot account' }).first()).toBeVisible();

        await settings.click();
        await expect(page.locator('.ingot-settings-top')).toBeVisible();
    });
});
