import { expect, test } from '@playwright/test';
import { dismissNotifications, openIngot, signOutIfSignedIn } from '../src/app.utils';
import { signInToIngot, startProPlusServer } from '../src/account.e2e-utils';
import type { FakeIngotServer } from '../src/fake-ingot-server';
import { pinZaprexDesktop, unpinZaprexDesktop } from '../src/zaprex.e2e-utils';

/**
 * IDEA-173 / IDEA-179: Zaprex is its own app. The IDE has no Zaprex panel and no Zaprex button in the composer or the
 * agent header; the one title bar T-rex ("Hand off to Rex") only shows during a heavy run (see zaprex-plan.spec).
 */
test.describe('IDEA-173 Zaprex link', () => {
    let account: FakeIngotServer;
    test.beforeEach(async () => {
        account = await startProPlusServer();
        pinZaprexDesktop(false);
    });
    test.afterEach(async ({ page }) => {
        await signOutIfSignedIn(page).catch(() => undefined);
        await account.close();
        unpinZaprexDesktop();
    });

    test('no Zaprex panel or extra buttons, and no T-rex while no heavy run is going', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        await signInToIngot(page);
        await expect(page.locator('.ingot-tb-window-actions')).toBeVisible();
        await expect(page.locator('#ingot-tb-zaprex')).toHaveCount(0);
        await expect(page.locator('#ingot-composer-zaprex')).toHaveCount(0);
        await expect(page.locator('#ingot-agents-zaprex')).toHaveCount(0);
        await expect(page.locator('#ingot-bot-root')).toHaveCount(0);
    });

    test('the command palette has no Zaprex panel command', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        await page.keyboard.press('F1');
        const input = page.locator('.quick-input-widget input');
        await input.fill('>Zaprex');
        await expect(page.locator('.quick-input-list .monaco-list-row', { hasText: 'Zaprex' })).toHaveCount(0);
        await page.keyboard.press('Escape');
    });
});
