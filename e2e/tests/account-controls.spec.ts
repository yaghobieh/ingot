import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot, runCommand, signOutIfSignedIn } from '../src/app.utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeIngotServer, type FakeIngotServer } from '../src/fake-ingot-server';

/** Optional: where to save review screenshots (outside the repo). */
const SHOTS = process.env.INGOT_SCREENSHOT_DIR;
const shot = async (page: Page, name: string): Promise<void> => {
    if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    }
};

const signIn = async (page: Page): Promise<void> => {
    await openIngot(page);
    await dismissNotifications(page);
    const popup = page.waitForEvent('popup');
    await runCommand(page, 'Account: Sign in to Ingot…');
    (await popup).close();
    await expect(page.locator('#status-bar-ingot-account-status')).toContainText('left');
};

const send = async (page: Page, text: string): Promise<void> => {
    await page.locator('#ingot-composer-input').click();
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
};

const systemText = (page: Page) => page.locator('.ingot-chat-system').last();

/** IDEA-124: the server controls the model list, limits, kill switches, blocked accounts and the admin link. */
test.describe('IDEA-124 server-controlled models and account state', () => {
    let server: FakeIngotServer;
    test.beforeEach(async () => { server = await startFakeIngotServer(); });
    test.afterEach(async ({ page }) => {
        server.blocked = false;
        await signOutIfSignedIn(page);
        await server.close();
    });

    test('picker follows the server order and greys out unavailable models; no admin link for users', async ({ page }) => {
        await signIn(page);
        await page.locator('#ingot-agents-new').click();
        await page.locator('#ingot-composer-model').click();
        await page.locator('#ingot-model-picker .ingot-pick-family', { hasText: 'Ingot' }).first().click();
        const rows = page.locator('#ingot-model-picker [data-model^="ingot:"]');
        await expect(rows).toHaveCount(3);
        await expect.poll(() => rows.evaluateAll(els => els.map(e => e.getAttribute('data-model')))).toEqual(['ingot:ingot-mock', 'ingot:ingot-fast', 'ingot:ingot-reasoning']);
        const reasoning = page.locator('#ingot-model-picker [data-model="ingot:ingot-reasoning"]');
        await expect(reasoning).toHaveAttribute('aria-disabled', 'true');
        await expect(reasoning).toHaveAttribute('title', 'No provider can run this model right now');
        await shot(page, 'picker-order-unavailable');
        await reasoning.click({ force: true });
        await expect(page.locator('#ingot-model-picker')).toBeVisible();
        await expect(reasoning).not.toHaveClass(/selected/);
        await page.keyboard.press('Escape');
        await page.locator('#ingot-stripe-account').click();
        await expect(page.locator('.lm-Menu .lm-Menu-itemLabel', { hasText: 'Open Dashboard' })).toBeVisible();
        await expect(page.locator('.lm-Menu .lm-Menu-itemLabel', { hasText: 'Open admin console' })).toHaveCount(0);
        await page.keyboard.press('Escape');
    });

    test('429 counts down Retry-After and retries once; 402 stops with an Open usage link', async ({ page }) => {
        await signIn(page);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ingot:ingot-mock');
        server.chatErrors.push({ status: 429, code: 'rate_limited', message: 'Too many requests per minute.', headers: { 'retry-after': '3' }, details: { scope: 'user', retry_after_seconds: 3 } });
        await send(page, 'first try');
        await expect(systemText(page)).toContainText('Too many requests per minute. Retrying in 0:0');
        await shot(page, 'rate-limit-countdown');
        await expect(page.locator('.ingot-chat-agent .ingot-md').last()).toContainText('Echo: first try', { timeout: 15_000 });
        expect(server.calls.filter(c => c.model === 'ingot-mock')).toHaveLength(2);

        server.chatErrors.push({ status: 402, code: 'token_allowance_exhausted', message: 'You have used all the tokens on your plan.', details: { scope: 'plan', unit: 'tokens' } });
        await send(page, 'second try');
        await expect(systemText(page)).toContainText(`You have used all the tokens on your plan. Open usage: ${server.url}/dashboard/usage`);
        await shot(page, 'allowance-exhausted');
        expect(server.calls.filter(c => c.model === 'ingot-mock')).toHaveLength(3);
    });

    test('a kill-switched model falls back to the server default with a notice', async ({ page }) => {
        await signIn(page);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ingot:ingot-mock');
        server.disabledModels.add('ingot-mock');
        server.chatErrors.push({ status: 503, code: 'model_disabled', message: 'This model was turned off by an administrator.' });
        await send(page, 'use the mock');
        await expect(systemText(page)).toContainText('This model was turned off by an administrator. Switched to Ingot Fast; send your message again.');
        await shot(page, 'model-disabled-fallback');
        await send(page, 'again');
        await expect(page.locator('.ingot-chat-agent .ingot-md').last()).toContainText('Echo: again');
        expect(server.calls.at(-1)?.model).toBe('ingot-fast');
    });

    test('admins get "Open admin console"; a blocked account gets the blocking screen', async ({ page }) => {
        server.role = 'admin';
        await signIn(page);
        await page.locator('#ingot-stripe-account').click();
        const admin = page.locator('.lm-Menu .lm-Menu-itemLabel', { hasText: 'Open admin console' });
        await expect(admin).toBeVisible();
        await shot(page, 'account-menu-admin');
        const popup = page.waitForEvent('popup');
        await admin.click();
        const portal = await popup;
        expect(portal.url()).toBe(`${server.url}/admin`);
        await portal.close();

        server.blocked = true;
        await runCommand(page, 'Account: Refresh Usage');
        const blocked = page.locator('#ingot-blocked-screen');
        await expect(blocked).toBeVisible();
        await expect(blocked).toContainText('This account is blocked');
        await expect(page.locator('#status-bar-ingot-account-status')).toContainText('Account blocked');
        await shot(page, 'account-blocked');
        await page.locator('#ingot-blocked-screen-sign-out').click();
        await expect(blocked).toHaveCount(0);
        await expect(page.locator('#status-bar-ingot-account-status')).toContainText('Sign in');
    });
});
