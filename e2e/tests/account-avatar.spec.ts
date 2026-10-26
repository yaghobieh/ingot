import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot, runCommand, signOutIfSignedIn } from '../src/app.utils';
import { startFakeIngotServer, type FakeIngotServer } from '../src/fake-ingot-server';

/** IDEA-143: the Google / GitHub photo shows in the stripe account button, Settings › Account and on your chat messages; initials otherwise. */
const PHOTO_URL = 'https://avatars.ingot-e2e.test/u/1.png';
// 2x2 gold PNG, served for PHOTO_URL so the test never touches the network.
const PNG = Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAIAAAACCAIAAAD91JpzAAAAFklEQVR4nGPYuWDB/zkzGP7PmcHwfwYAQVsIEe4Ihy0AAAAASUVORK5CYII=', 'base64');
const SHOTS_DIR = process.env.INGOT_SHOTS_DIR;
const AVATAR_CACHE_KEY = 'ingot.account.avatar';

const signIn = async (page: Page): Promise<void> => {
    const popup = page.waitForEvent('popup');
    await runCommand(page, 'Account: Sign in to Ingot…');
    (await popup).close();
    await expect(page.locator('#status-bar-ingot-account-status')).toContainText('left');
};

const openAccountSettings = async (page: Page): Promise<void> => {
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), page.locator('#ingot-settings'));
    await page.locator('#ingot-settings-node-account').click();
    await expect(page.locator('#ingot-settings-account')).toBeVisible();
};

test.describe('IDEA-143 account avatar', () => {
    let server: FakeIngotServer;
    test.beforeEach(async ({ page }) => {
        server = await startFakeIngotServer();
        await page.route('https://avatars.ingot-e2e.test/**', route => route.fulfill({ status: 200, contentType: 'image/png', body: PNG, headers: { 'access-control-allow-origin': '*' } }));
    });
    test.afterEach(async ({ page }) => {
        await signOutIfSignedIn(page);
        await server.close();
    });

    test('no photo: initials in the stripe and Settings › Account', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        await signIn(page);
        const stripe = page.locator('#ingot-stripe-avatar');
        await expect(stripe).toHaveAttribute('data-kind', 'initials');
        await expect(stripe).toHaveText('TU');
        await openAccountSettings(page);
        await expect(page.locator('#ingot-settings-avatar')).toHaveAttribute('data-kind', 'initials');
        await expect(page.locator('#ingot-settings-account')).toContainText('Sign in with Google or GitHub');
        await page.keyboard.press('Escape');
    });

    for (const scheme of ['light', 'dark'] as const) {
        test(`provider photo is shown, cached on this device and dropped on sign-out (${scheme})`, async ({ page }) => {
            server.avatarUrl = PHOTO_URL;
            await page.emulateMedia({ colorScheme: scheme });
            await openIngot(page);
            await dismissNotifications(page);
            await page.locator('#ingot-rs-theme').click();
            await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'System' }).first().click();
            await expect(page.locator('body')).toHaveClass(new RegExp(`ingot-${scheme}`));
            await signIn(page);

            const stripe = page.locator('#ingot-stripe-avatar');
            await expect(stripe).toHaveAttribute('data-kind', 'photo');
            // Cached as a data URL (refreshed on sign-in / sync), so the photo also shows offline.
            await expect.poll(() => page.evaluate(key => JSON.parse(localStorage.getItem(key) ?? '{}').url, AVATAR_CACHE_KEY)).toBe(PHOTO_URL);
            await expect(stripe).toHaveAttribute('src', /^data:image\/png;base64,/);

            await page.locator('#ingot-agents-new').click();
            await page.locator('#ingot-composer-input').click();
            await page.keyboard.type('hello from my account');
            await page.keyboard.press('Enter');
            const mine = page.locator('.ingot-chat-user.ingot-chat-has-avatar').first();
            await expect(mine).toContainText('hello from my account');
            await expect(mine.locator('.ingot-chat-user-avatar')).toHaveAttribute('data-kind', 'photo');
            await expect(mine).not.toContainText('TU');
            if (SHOTS_DIR) {
                fs.mkdirSync(SHOTS_DIR, { recursive: true });
                await page.waitForTimeout(500);
                await page.screenshot({ path: path.join(SHOTS_DIR, `ide-avatar-chat-${scheme}.png`) });
            }

            await openAccountSettings(page);
            await expect(page.locator('#ingot-settings-avatar')).toHaveAttribute('data-kind', 'photo');
            await expect(page.locator('#ingot-settings-account-name')).toHaveText('Test User');
            await expect(page.locator('#ingot-settings-account')).toContainText('Photo from your Google or GitHub account');
            if (SHOTS_DIR) {
                await page.screenshot({ path: path.join(SHOTS_DIR, `ide-avatar-settings-${scheme}.png`) });
            }
            await page.keyboard.press('Escape');

            await signOutIfSignedIn(page);
            await expect.poll(() => page.evaluate(key => localStorage.getItem(key), AVATAR_CACHE_KEY)).toBeNull();
        });
    }

    test('a photo that fails to load falls back to initials', async ({ page }) => {
        server.avatarUrl = 'https://avatars.ingot-e2e.test/missing.png';
        await page.route('https://avatars.ingot-e2e.test/missing.png', route => route.fulfill({ status: 404, body: '' }));
        await openIngot(page);
        await dismissNotifications(page);
        await signIn(page);
        await expect(page.locator('#ingot-stripe-avatar')).toHaveAttribute('data-kind', 'initials');
        await expect(page.locator('#ingot-stripe-avatar')).toHaveText('TU');
    });
});
