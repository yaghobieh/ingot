import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot, signOutIfSignedIn } from '../src/app.utils';
import { signInToIngot } from '../src/account.e2e-utils';
import { setSettings } from '../src/autopilot.e2e-utils';
import { openChat, pickModel } from '../src/chat.e2e-utils';
import { ATTACH_ACTIVE_FILE } from '../src/e2e.consts';
import { startFakeIngotServer, type FakeIngotServer } from '../src/fake-ingot-server';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/**
 * The file open in the editor is NOT attached to the chat composer by default. "Attach active file automatically"
 * (Settings › Tools › AI & Zaprex › Chat) turns the removable file chip on; it is honoured on a new chat, when the
 * editor switches files, and after a reload.
 */
const CURRENT_FILE = 'Current file:';

const makeProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-attach-')));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'alpha.ts'), 'export const ALPHA = 1;\n');
    fs.writeFileSync(path.join(dir, 'src', 'beta.ts'), 'export const BETA = 2;\n');
    return dir;
};

const fileChip = (page: Page) => page.locator('#ingot-auto-chip-file');

/** Makes `name` the current editor: its tab when it is open (e.g. restored after a reload), else Go to File. */
const openFile = async (page: Page, name: string): Promise<void> => {
    const tabs = page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: name });
    await expect(async () => {
        await page.keyboard.press('Escape');
        if (await tabs.count()) {
            await tabs.first().click();
        } else {
            await page.keyboard.press('Control+p');
            await page.locator('.quick-input-widget input').fill(name);
            await page.locator('.quick-input-widget .monaco-list-row', { hasText: name }).first().click({ timeout: 3_000 });
        }
        await expect(tabs.and(page.locator('.lm-mod-current'))).toHaveCount(1, { timeout: 3_000 });
    }).toPass({ timeout: 40_000 });
};

const newChat = async (page: Page): Promise<void> => {
    await openChat(page);
    await page.locator('#ingot-agents-new').click();
};

/** Reloads the window; signs in again when the reload came back signed out (chat is a Pro feature). */
const reload = async (page: Page, dir: string): Promise<void> => {
    await openIngot(page, dir);
    await dismissNotifications(page);
    const status = page.locator('#status-bar-ingot-account-status');
    await expect(status).toContainText(/left|Sign in/);
    if ((await status.innerText()).includes('Sign in')) {
        await signInToIngot(page);
    }
};

const send = async (page: Page, text: string): Promise<void> => {
    await pickModel(page, 'ollama-local');
    await page.locator('#ingot-composer-input').fill(text);
    await page.locator('#ingot-composer-input').press('Enter');
    await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('Echo', { timeout: 30_000 });
};

test.describe('Attach active file automatically', () => {
    test.setTimeout(240_000);
    let dir: string;
    let account: FakeIngotServer;
    let models: FakeOllama;

    test.beforeEach(async () => {
        dir = makeProject();
        account = await startFakeIngotServer();
        models = await startFakeOllama((_system, user) => `Echo: ${user.slice(0, 30)}`, { delayMs: 0, chunkSize: 4_000 });
    });

    test.afterEach(async ({ page }) => {
        await setSettings(page, 'ai-zaprex', { [ATTACH_ACTIVE_FILE]: false }).catch(() => undefined);
        await signOutIfSignedIn(page).catch(() => undefined);
        await account.close();
        await models.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('off by default; on follows new chats, file switches and reloads; off again removes it', async ({ page }) => {
        await openIngot(page, dir);
        await dismissNotifications(page);
        await expect(page.locator('#status-bar-ingot-account-status')).toBeVisible();
        await signOutIfSignedIn(page);
        await signInToIngot(page);
        await connectOllama(page, models);

        // Default off: no file chip on a new chat, after a file switch, or in what is sent.
        await openFile(page, 'alpha.ts');
        await newChat(page);
        await expect(page.locator('#ingot-composer-input')).toBeVisible();
        await expect(fileChip(page)).toHaveCount(0);
        await openFile(page, 'beta.ts');
        await expect(fileChip(page)).toHaveCount(0);
        await send(page, 'hello while off');
        expect(models.requests.filter(r => r.user.includes('hello while off')).every(r => !r.system.includes(CURRENT_FILE))).toBe(true);
        await expect(page.locator('#ingot-agents .ingot-chat-user').last().locator('.ingot-chat-auto')).toHaveCount(0);

        // Turned on: the chip shows the current file and follows the editor.
        await setSettings(page, 'ai-zaprex', { [ATTACH_ACTIVE_FILE]: true });
        await expect(fileChip(page)).toContainText('beta.ts');
        await openFile(page, 'alpha.ts');
        await expect(fileChip(page)).toContainText('alpha.ts');
        await newChat(page);
        await expect(fileChip(page)).toContainText('alpha.ts');
        await send(page, 'hello while on');
        expect(models.requests.filter(r => r.user.includes('hello while on')).some(r => r.system.includes(`${CURRENT_FILE} src/alpha.ts`))).toBe(true);

        // Reload: the setting sticks.
        await reload(page, dir);
        await openFile(page, 'beta.ts');
        await newChat(page);
        await expect(fileChip(page)).toContainText('beta.ts');

        // Off again: the chip goes away at once and stays away after a reload.
        await setSettings(page, 'ai-zaprex', { [ATTACH_ACTIVE_FILE]: false });
        await expect(fileChip(page)).toHaveCount(0);
        await reload(page, dir);
        await openFile(page, 'alpha.ts');
        await newChat(page);
        await expect(page.locator('#ingot-composer-input')).toBeVisible();
        await expect(fileChip(page)).toHaveCount(0);
    });
});
