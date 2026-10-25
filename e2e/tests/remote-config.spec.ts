import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot, runCommand, signOutIfSignedIn } from '../src/app.utils';
import { CONFIG_PROJECT } from '../src/e2e.consts';
import { startFakeIngotServer, type FakeIngotServer } from '../src/fake-ingot-server';

const SHOTS = process.env.INGOT_SCREENSHOT_DIR;
const shot = async (page: Page, name: string): Promise<void> => {
    if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    }
};

/** IDEA-125: GET /v1/config drives feature flags, the update notice and the force-update screen. */
test.describe('IDEA-125 remote config, flags and updates', () => {
    let server: FakeIngotServer;
    test.beforeEach(async () => { server = await startFakeIngotServer(); });
    test.afterEach(async ({ page }) => {
        await signOutIfSignedIn(page);
        await server.close();
    });

    test('flags gate the mic and the MCP marketplace; config is fetched signed out and again after sign-in', async ({ page }) => {
        server.flags = { mic_dictation: false, mcp_marketplace: false };
        await openIngot(page, CONFIG_PROJECT);
        await dismissNotifications(page);
        await expect.poll(() => server.configCalls.length).toBeGreaterThan(0);
        expect(server.configCalls[0]).toEqual({ version: '0.1.0', signedIn: false });
        await page.locator('#ingot-agents-new').click();
        await expect(page.locator('#ingot-composer-input')).toBeVisible();
        await expect(page.locator('#ingot-composer-mic')).toHaveCount(0);
        await page.locator('#ingot-rs-mcp').click();
        await expect(page.locator('#ingot-mcp-search')).toBeVisible();
        await expect(page.locator('#ingot-mcp-browse')).toHaveCount(0);
        await shot(page, 'flags-off-marketplace-hidden');

        server.flags = {};
        const popup = page.waitForEvent('popup');
        await runCommand(page, 'Account: Sign in to Ingot…');
        (await popup).close();
        await expect(page.locator('#status-bar-ingot-account-status')).toContainText('left');
        await expect.poll(() => server.configCalls.some(c => c.signedIn)).toBe(true);
        await expect(page.locator('#ingot-mcp-browse')).toBeVisible();
        await page.locator('#ingot-rs-agents').click();
        await expect(page.locator('#ingot-composer-mic')).toBeVisible();
    });

    test('update notice offers Download, Release notes and Later; Later is remembered for that version', async ({ page }) => {
        server.update = { latestVersion: '9.9.0', updateAvailable: true };
        await openIngot(page);
        const notice = page.locator('.theia-notification-list-item').filter({ hasText: 'Ingot 9.9.0 is available.' });
        await expect(notice).toBeVisible();
        await expect(notice.getByRole('button', { name: 'Download' })).toBeVisible();
        await expect(notice.getByRole('button', { name: 'Release notes' })).toBeVisible();
        await shot(page, 'update-notice');
        await notice.getByRole('button', { name: 'Later' }).click();
        await expect(notice).toHaveCount(0);
        expect(await page.evaluate(() => localStorage.getItem('ingot.update.dismissed'))).toBe('9.9.0');
        await page.reload();
        await expect.poll(() => server.configCalls.length).toBeGreaterThan(1);
        await expect(page.locator('#ingot-composer-input, #ingot-agents-new').first()).toBeVisible();
        await expect(page.locator('.theia-notification-list-item').filter({ hasText: 'is available.' })).toHaveCount(0);
        await page.evaluate(() => localStorage.removeItem('ingot.update.dismissed'));
    });

    test('force update blocks with Download; the agent refuses to run until updated', async ({ page }) => {
        server.update = { minVersion: '9.0.0', latestVersion: '9.0.0', forceUpdate: true };
        await openIngot(page);
        const screen = page.locator('#ingot-force-update');
        await expect(screen).toBeVisible();
        await expect(screen).toContainText('This version is no longer supported');
        await expect(screen).toContainText('Download version 9.0.0 or later');
        await shot(page, 'force-update');
        const popup = page.waitForEvent('popup');
        await page.locator('#ingot-force-update-download').click();
        const download = await popup;
        expect(download.url()).toBe(`${server.url}/download`);
        await download.close();
        await page.locator('#ingot-force-update-continue').click();
        await expect(screen).toBeHidden();
        await dismissNotifications(page);
        await page.locator('#ingot-agents-new').click();
        await page.locator('#ingot-composer-input').click();
        await page.keyboard.type('hello');
        await page.keyboard.press('Enter');
        await expect(page.locator('.ingot-chat-system').last()).toContainText('This version of Ingot is no longer supported.');
        expect(server.calls).toHaveLength(0);
    });
});
