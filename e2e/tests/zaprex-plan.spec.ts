import { expect, test } from '@playwright/test';
import { dismissNotifications, openIngot, runCommand, signOutIfSignedIn } from '../src/app.utils';
import { signInToIngot } from '../src/account.e2e-utils';
import { shot } from '../src/agent-tools.e2e-utils';
import { PRO_PLUS_PLAN } from '../src/e2e.consts';
import { startFakeIngotServer, type FakeIngotServer } from '../src/fake-ingot-server';

/** The Zaprex (Rex) app entry is a PRO+ feature: hidden signed out and on free / pro, shown on PRO+, read from the session. */
test.describe('Zaprex entry by plan', () => {
    let server: FakeIngotServer;

    test.beforeEach(async () => {
        server = await startFakeIngotServer();
    });

    test.afterEach(async ({ page }) => {
        await signOutIfSignedIn(page).catch(() => undefined);
        await server.close();
    });

    test('only a PRO+ session shows the title bar T-rex', async ({ page }) => {
        test.setTimeout(120_000);
        await openIngot(page);
        await dismissNotifications(page);
        const trex = page.locator('#ingot-tb-zaprex');
        await expect(page.locator('#ingot-tb-agents-window')).toBeVisible();
        await expect(trex).toHaveCount(0);

        for (const plan of ['free', 'pro']) {
            server.plan = plan;
            await signInToIngot(page);
            await expect(page.locator('#status-bar-ingot-account-status')).toBeVisible();
            await expect(trex).toHaveCount(0);
            await runCommand(page, 'Account: Sign Out');
            await expect(page.locator('#status-bar-ingot-account-status')).toContainText('Sign in');
        }

        server.plan = PRO_PLUS_PLAN;
        await signInToIngot(page);
        await expect(trex).toBeVisible();
        await shot(page, 'zaprex-pro-plus-titlebar.png');

        await runCommand(page, 'Account: Sign Out');
        await expect(page.locator('#status-bar-ingot-account-status')).toContainText('Sign in');
        await expect(trex).toHaveCount(0);
    });
});
