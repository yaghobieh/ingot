import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot, runCommand, signOutIfSignedIn } from '../src/app.utils';
import { startFakeIngotServer, type FakeIngotServer } from '../src/fake-ingot-server';

/** Optional: where to save review screenshots (outside the repo). */
const SHOTS = process.env.INGOT_SCREENSHOT_DIR;
const shot = async (page: Page, name: string): Promise<void> => {
    if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    }
};

const setTheme = async (page: Page, label: string): Promise<void> => {
    await runCommand(page, 'Preferences: Color Theme');
    await page.locator('.quick-input-widget input').fill(label);
    await page.locator('.quick-input-list .monaco-list-row', { hasText: label }).first().click();
    await expect(page.locator('body')).toHaveClass(new RegExp(label === 'Ingot Dark' ? 'theia-dark' : 'theia-light'));
};

const signIn = async (page: Page): Promise<void> => {
    const popup = page.waitForEvent('popup');
    await runCommand(page, 'Account: Sign in to Ingot…');
    (await popup).close();
    await expect(page.locator('#status-bar-ingot-account-status')).toContainText('left');
};

/** IDEA-154: the Ingot Bot panel shares the website thread, pauses on approvals and lists runs; the token stays in the backend. */
test.describe('IDEA-154 Zaprex panel', () => {
    let server: FakeIngotServer;
    test.beforeEach(async () => { server = await startFakeIngotServer(); });
    test.afterEach(async ({ page }) => {
        await signOutIfSignedIn(page);
        await server.close();
    });

    test('signed out shows sign in; a plan without the bot sees the upgrade card', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        await runCommand(page, 'Zaprex');
        await expect(page.locator('#ingot-bot-signed-out')).toBeVisible();
        server.bot.enabled = false;
        await signIn(page);
        await page.locator('#ingot-bot-refresh').click();
        await expect(page.locator('#ingot-bot-upsell')).toContainText('Pro+');
    });

    test('a task waits for approval, then finishes with a draft PR; runs show status and log', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        await signIn(page);
        await runCommand(page, 'Zaprex');
        await expect(page.locator('#ingot-bot-usage')).toContainText('3 / 300 min this month');
        await expect(page.locator('#ingot-bot-test-mode')).toBeVisible();
        await page.locator('#ingot-bot-repo').selectOption({ label: 'ingot-dev/sample-app' });

        await page.locator('#ingot-bot-input').fill('Fix the failing tests and add a dependency for dates');
        await page.locator('#ingot-bot-send').click();
        const approval = page.locator('#ingot-bot-approval');
        await expect(approval).toContainText('Add or upgrade dependencies');
        await expect(page.locator('#ingot-bot-runs')).toContainText('Waiting for you');
        await setTheme(page, 'Ingot Dark');
        await shot(page, 'ide-bot-approval-dark');
        await setTheme(page, 'Ingot Light');
        await shot(page, 'ide-bot-approval-light');

        await page.locator('#ingot-bot-approve').click();
        await expect(approval).toBeHidden();
        await expect(page.locator('#ingot-bot-pr-link')).toHaveAttribute('href', 'https://github.com/ingot-dev/sample-app/pull/7');
        await expect(page.locator('#ingot-bot-runs')).toContainText('Done');
        await page.locator('#ingot-bot-runs .ingot-process-row').first().click();
        await expect(page.locator('#ingot-bot-run-log')).toContainText('$ npm test → exit 1');
        await shot(page, 'ide-bot-done-light');
        await setTheme(page, 'Ingot Dark');
        await shot(page, 'ide-bot-done-dark');

        // Every bot call carried the IDE token from the backend, only to /api/bot, and never the GitHub OAuth start.
        expect(server.bot.calls.length).toBeGreaterThan(0);
        expect(server.bot.calls.every(call => call.authorization === 'Bearer ingot_at_e2e_access')).toBe(true);
        expect(server.bot.calls.some(call => call.path.startsWith('/api/bot/github/connect'))).toBe(false);
        const html = await page.content();
        expect(html).not.toContain('ingot_at_e2e_access');
        await setTheme(page, 'Ingot Light');
    });
});
