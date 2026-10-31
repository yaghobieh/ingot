import * as fs from 'fs';
import * as path from 'path';
import { expect, test } from '@playwright/test';
import { dismissNotifications, openIngot, signOutIfSignedIn } from '../src/app.utils';
import { signInToIngot } from '../src/account.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { E2E_CONFIG_DIR } from '../src/e2e.consts';
import { startFakeIngotServer } from '../src/fake-ingot-server';
import { startFakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/** IDEA-265: a backslash always types in the composer, even when a workbench keybinding uses it. */
const KEYMAPS = path.join(E2E_CONFIG_DIR, 'keymaps.json');
const TYPED = 'open C:\\src\\app and a\\\\b';

test.describe('IDEA-265 composer typed keys', () => {
    test('a keybinding on backslash does not swallow it in the composer', async ({ page }) => {
        test.setTimeout(120_000);
        const before = fs.existsSync(KEYMAPS) ? fs.readFileSync(KEYMAPS, 'utf8') : undefined;
        fs.writeFileSync(KEYMAPS, JSON.stringify([{ key: '\\', command: 'workbench.action.showCommands' }]));
        const server = await startFakeOllama(() => 'Got the path.', { delayMs: 0 });
        // The plan gate (IDEA-271) hides chat when signed out; the fake account is on Pro.
        const account = await startFakeIngotServer();
        try {
            await openIngot(page);
            await dismissNotifications(page);
            // The binding is live: outside the composer, `\` opens the command palette.
            await expect(async () => {
                await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
                await page.keyboard.press('Backslash');
                await expect(page.locator('.quick-input-widget')).toBeVisible({ timeout: 2_000 });
            }).toPass({ timeout: 30_000 });
            await page.keyboard.press('Escape');
            await expect(page.locator('.quick-input-widget')).toBeHidden();

            await signInToIngot(page);
            await connectOllama(page, server);
            const newChat = page.locator('#ingot-agents-new');
            if (!await newChat.isVisible()) {
                await page.locator('#ingot-rs-agents').click();
            }
            await newChat.click();
            await pickModel(page, 'ollama-local');
            const input = page.locator('#ingot-composer-input');
            await input.click();
            await page.keyboard.type(TYPED);
            await expect(input).toHaveText(TYPED);
            await expect(page.locator('.quick-input-widget')).toBeHidden();
            await page.keyboard.press('Enter');
            await expect(page.locator('#ingot-msg-0')).toContainText(TYPED);
            await expect.poll(() => server.requests.some(r => r.user === TYPED)).toBe(true);
        } finally {
            await signOutIfSignedIn(page).catch(() => undefined);
            await account.close();
            if (before === undefined) {
                fs.rmSync(KEYMAPS, { force: true });
            } else {
                fs.writeFileSync(KEYMAPS, before);
            }
            await server.close();
        }
    });
});
