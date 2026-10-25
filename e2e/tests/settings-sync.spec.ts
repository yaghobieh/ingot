import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot, runCommand, signOutIfSignedIn } from '../src/app.utils';
import { E2E_CONFIG_DIR } from '../src/e2e.consts';
import { startFakeIngotServer, type FakeIngotServer } from '../src/fake-ingot-server';

const SHOTS = process.env.INGOT_SCREENSHOT_DIR;
const shot = async (page: Page, name: string): Promise<void> => {
    if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    }
};

const SETTINGS_FILE = path.join(E2E_CONFIG_DIR, 'settings.json');
const RULES_DIR = path.join(E2E_CONFIG_DIR, 'rules');
const LOCAL_RULE = path.join(RULES_DIR, 'e2e-local-sync.md');
const REMOTE_RULE = path.join(RULES_DIR, 'e2e-team-sync.md');
const syncToggle = (page: Page) => page.locator('#ingot-setting-ingot-account-syncSettings');

const openAccountSettings = async (page: Page): Promise<void> => {
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), page.locator('#ingot-settings'));
    await page.locator('#ingot-settings-node-account').click();
    await expect(page.locator('#ingot-settings-page-account')).toBeVisible();
};

/** IDEA-126: settings, global rules, keybindings and chat metadata sync through /v1/sync. */
test.describe('IDEA-126 settings sync', () => {
    let server: FakeIngotServer;
    let settingsBackup: string | undefined;
    test.beforeEach(async () => {
        server = await startFakeIngotServer();
        settingsBackup = fs.existsSync(SETTINGS_FILE) ? fs.readFileSync(SETTINGS_FILE, 'utf8') : undefined;
    });
    test.afterEach(async ({ page }) => {
        await signOutIfSignedIn(page);
        await server.close();
        for (const file of [LOCAL_RULE, REMOTE_RULE]) {
            fs.rmSync(file, { force: true });
        }
        if (settingsBackup !== undefined) {
            fs.writeFileSync(SETTINGS_FILE, settingsBackup);
        }
    });

    test('Settings > Account has "Sync settings", on by default', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        await openAccountSettings(page);
        await expect(page.locator('#ingot-settings-page-account')).toContainText('Sync settings');
        await expect(syncToggle(page)).toBeChecked();
        await shot(page, 'settings-account-sync');
        await page.locator('#ingot-settings-cancel').click();
    });

    test('sign-in pulls other devices\' changes, pushes local ones with a device id, deletes tombstones; never account settings', async ({ page }) => {
        server.seedSync('settings', 'editor.fontSize', { value: 17 });
        server.seedSync('rules', 'rules/e2e-team-sync.md', { text: '# Team rule\nUse tabs.\n' });
        fs.mkdirSync(RULES_DIR, { recursive: true });
        fs.writeFileSync(LOCAL_RULE, '# Local rule\nPrefer small diffs.\n');

        await openIngot(page);
        await dismissNotifications(page);
        const popup = page.waitForEvent('popup');
        await runCommand(page, 'Account: Sign in to Ingot…');
        (await popup).close();
        await expect(page.locator('#status-bar-ingot-account-status')).toContainText('left');

        await expect.poll(() => fs.existsSync(REMOTE_RULE) && fs.readFileSync(REMOTE_RULE, 'utf8')).toBe('# Team rule\nUse tabs.\n');
        await expect.poll(() => fs.readFileSync(SETTINGS_FILE, 'utf8')).toMatch(/"editor\.fontSize":\s*17/);
        await expect.poll(() => server.sync.get('rules|rules/e2e-local-sync.md')?.data).toEqual({ text: '# Local rule\nPrefer small diffs.\n' });
        expect(server.sync.get('settings|ingot.models.byok')?.data).toEqual({ value: true });
        const write = server.syncWrites.find(w => w.key === 'rules/e2e-local-sync.md')!;
        expect(write.device).toMatch(/^ide-/);
        expect(write.baseVersion).toBeUndefined();
        // Pulled items are not pushed back, and the account URLs / toggle never leave the machine.
        expect(server.syncWrites.some(w => w.key === 'rules/e2e-team-sync.md' || w.key === 'editor.fontSize')).toBe(false);
        expect([...server.sync.keys()].some(k => k.startsWith('settings|ingot.account.'))).toBe(false);

        // A local edit goes up with baseVersion = the version last seen.
        fs.writeFileSync(LOCAL_RULE, '# Local rule\nPrefer small diffs.\nWrite tests.\n');
        await runCommand(page, 'Account: Sync Settings Now');
        await expect.poll(() => server.sync.get('rules|rules/e2e-local-sync.md')?.version).toBe(2);
        expect(server.syncWrites.filter(w => w.key === 'rules/e2e-local-sync.md').at(-1)?.baseVersion).toBe(1);

        // Deleting locally sends a tombstone; another device's tombstone deletes the file here.
        fs.rmSync(LOCAL_RULE);
        server.sync.set('rules|rules/e2e-team-sync.md', { ...server.sync.get('rules|rules/e2e-team-sync.md')!, deleted: true, data: null, version: 2, seq: 1000, device: 'other-device' });
        await runCommand(page, 'Account: Sync Settings Now');
        await expect.poll(() => server.sync.get('rules|rules/e2e-local-sync.md')?.deleted).toBe(true);
        await expect.poll(() => fs.existsSync(REMOTE_RULE)).toBe(false);
        await shot(page, 'settings-sync-signed-in');
    });

    test('turning "Sync settings" off stops syncing', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        await openAccountSettings(page);
        await syncToggle(page).click();
        await page.locator('#ingot-settings-ok').click();
        const popup = page.waitForEvent('popup');
        await runCommand(page, 'Account: Sign in to Ingot…');
        (await popup).close();
        await expect(page.locator('#status-bar-ingot-account-status')).toContainText('left');
        await page.waitForTimeout(3000);
        expect(server.syncWrites).toHaveLength(0);
        await openAccountSettings(page);
        await syncToggle(page).click();
        await page.locator('#ingot-settings-ok').click();
        await expect.poll(() => server.syncWrites.length).toBeGreaterThan(0);
    });
});
