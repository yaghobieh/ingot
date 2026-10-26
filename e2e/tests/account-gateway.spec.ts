import { expect, test } from '@playwright/test';
import { dismissNotifications, openIngot, runCommand, signOutIfSignedIn } from '../src/app.utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeIngotServer, type FakeIngotServer } from '../src/fake-ingot-server';

/**
 * IDEA-101: signed in, every model call goes to the Ingot gateway with the IDE access token (no provider keys),
 * and tokens left refresh right after each call.
 */
test.describe('IDEA-101 Ingot models by default', () => {
    let server: FakeIngotServer;
    test.beforeEach(async () => { server = await startFakeIngotServer(); });
    test.afterEach(async ({ page }) => {
        await signOutIfSignedIn(page);
        await server.close();
    });

    test('signed out: chat and picker offer "Sign in to use Ingot models"; dev sign-in goes through the portal dev login', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        await expect(page.locator('#status-bar-ingot-account-status')).toContainText('Sign in');
        // The e2e profile opts into BYOK; turn it off here to see the default (account-only) experience.
        await runCommand(page, 'Ingot: Models');
        const byok = page.locator('#ingot-models-byok');
        await byok.click();
        await expect(byok).not.toBeChecked();
        await expect(page.locator('#ingot-models-sign-in')).toBeVisible();
        await page.locator('#ingot-composer-model').click();
        await expect(page.locator('#ingot-pick-sign-in')).toHaveText('Sign in to use Ingot models');
        await page.keyboard.press('Escape');

        await page.locator('#ingot-agents-new').click();
        await page.locator('#ingot-composer-input').click();
        await page.keyboard.type('hello');
        await page.keyboard.press('Enter');
        const signIn = page.locator('#ingot-chat-sign-in-dev');
        await expect(signIn).toBeVisible();

        // IDEA-101: with a local portal the dev sign-in finishes on its own (dev login, Approve, loopback callback); no browser opens.
        let popups = 0;
        page.on('popup', () => { popups++; });
        await signIn.click();
        await expect.poll(() => server.authorizations.map(a => a.devLogin)).toEqual([true, false]);

        await expect(page.locator('#status-bar-ingot-account-status')).toContainText('1M left');
        expect(popups).toBe(0);
        await page.locator('#ingot-stripe-account').click();
        await expect(page.locator('.lm-Menu .lm-Menu-itemLabel', { hasText: 'Test User · Pro' })).toBeVisible();
        await page.keyboard.press('Escape');
        await runCommand(page, 'Ingot: Models');
        await byok.click();
        await expect(byok).toBeChecked();
    });

    test('model calls go to the gateway with the access token and tokens left update after the reply', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        const popup = page.waitForEvent('popup');
        await runCommand(page, 'Account: Sign in to Ingot…');
        (await popup).close();
        const status = page.locator('#status-bar-ingot-account-status');
        await expect(status).toContainText('1M left');

        await page.locator('#ingot-agents-new').click();
        // Signed in, Ingot models never ask for a key; one the gateway does not offer is marked Unavailable.
        await page.locator('#ingot-composer-model').click();
        await page.locator('#ingot-model-picker .ingot-pick-family', { hasText: 'Ingot' }).first().click();
        const ingotRows = page.locator('#ingot-model-picker [data-model^="ingot:"]');
        await expect(ingotRows.first()).toBeVisible();
        await expect(ingotRows.locator('.ingot-pick-addkey')).toHaveCount(0);
        await expect(page.locator('#ingot-model-picker [data-model="ingot:ingot-reasoning"] .ingot-pick-unavailable')).toHaveText('Unavailable');
        await expect(page.locator('#ingot-model-picker [data-model="ingot:ingot-mock"] .ingot-pick-unavailable')).toHaveCount(0);
        await page.keyboard.press('Escape');
        await pickModel(page, 'ingot:ingot-mock');
        await page.locator('#ingot-composer-input').click();
        await page.keyboard.type('summarize the cart module');
        await page.keyboard.press('Enter');
        await expect(page.locator('.ingot-chat-agent .ingot-md').last()).toContainText('Echo: summarize the cart module');
        expect(server.calls.at(-1)).toMatchObject({ model: 'ingot-mock', authorization: 'Bearer ingot_at_e2e_access', feature: 'agent' });
        // 1,500 tokens used → 998,500 left, refreshed without a reload.
        await expect(status).toContainText('998k left');

        await runCommand(page, 'Ingot: Models');
        await expect(page.locator('#ingot-model-status-ingot')).toHaveText('Signed in');
        await expect(page.locator('#ingot-models-byok')).toBeVisible();
    });
});
