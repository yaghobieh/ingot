import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickMode, pickModel } from '../src/chat.e2e-utils';
import { makeToolsProject } from '../src/agent-tools.e2e-utils';

/** IDEA-181: subagents run outside the main chat: a Subagents strip above the input, a one-line reference in the chat. */
const SHOTS = process.env.INGOT_SCREENSHOT_DIR;

const setScheme = async (page: Page, scheme: 'light' | 'dark'): Promise<void> => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.locator('#ingot-rs-theme').click();
    await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'System' }).first().click();
    await expect(page.locator('body')).toHaveClass(new RegExp(`ingot-${scheme}`));
};

for (const scheme of ['light', 'dark'] as const) {
    test.describe(`IDEA-181 Subagents strip (${scheme})`, () => {
        test.setTimeout(150_000);
        let dir: string;
        let server: FakeOllama;

        test.beforeEach(async () => {
            dir = makeToolsProject('ingot-subagents-');
            server = await startFakeOllama((_system, user) => {
                if (user.includes('This is subtask 1')) {
                    return 'PLAN:\n- Read the parser\n- Add the CSV parser\n\nAdded the parser.\n\n<<<EDIT src/csv.ts\nexport const parse = (s: string) => s.split(",");\n>>>END\n';
                }
                if (user.includes('This is subtask 2')) {
                    return 'The export menu needs one new item; nothing to change yet.';
                }
                return 'PLAN:\n- Build the CSV parser\n- Check the export menu\n';
            }, { delayMs: 40 });
        });
        test.afterEach(async () => {
            await server.close();
            fs.rmSync(dir, { recursive: true, force: true });
        });

        test('subagents show in the strip with status and details, the chat keeps one line', async ({ page }) => {
            await openIngot(page, dir);
            await dismissNotifications(page);
            await setScheme(page, scheme);
            await connectOllama(page, server);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            await pickMode(page, 'multi');
            await page.locator('#ingot-composer-input').fill('add CSV import');
            await page.locator('#ingot-composer-input').press('Enter');

            const strip = page.locator('#ingot-subagents');
            await expect(strip).toBeVisible({ timeout: 30_000 });
            await expect(strip.locator('.ingot-sa-row')).toHaveCount(2);
            await expect(strip.locator('.ingot-sa-count')).toHaveText('2');
            await expect(strip.locator('.ingot-sa-row').first()).toContainText('Build the CSV parser');
            await expect(strip.locator('#ingot-subagents-summary')).toHaveText(/(1 to review · 1 done|1 done · 1 to review|2 done)/, { timeout: 45_000 });
            // Subagents never open their own tabs or post their replies in the main chat.
            await expect(page.locator('.ingot-chat-tab')).toHaveCount(1);
            const chat = page.locator('#ingot-agents .ingot-agents-chat');
            await expect(chat).not.toContainText('Added the parser.');
            await expect(chat).not.toContainText('nothing to change yet');
            const refs = chat.locator('.ingot-chat-subref');
            await expect(refs.first()).toContainText('Started 2 subagents');
            await expect(refs.last()).toContainText('Subagents finished', { timeout: 45_000 });
            await expect(refs.first().locator('.ingot-chat-subref-view')).toBeVisible();

            // Details for one subagent: task, plan, edits and its reply.
            await strip.locator('.ingot-sa-row').first().click();
            const details = page.locator('#ingot-sa-details');
            await expect(details).toContainText('Build the CSV parser');
            await expect(details.locator('.ingot-sa-edits')).toContainText('src/csv.ts');
            await expect(details.locator('.ingot-sa-reply')).toContainText('Added the parser.');
            const row = strip.locator('.ingot-sa-row').first();
            await expect(row.locator('.ingot-sa-progress-fill')).toHaveCSS('width', /.+/);
            if (SHOTS) {
                fs.mkdirSync(SHOTS, { recursive: true });
                await page.locator('#ingot-agents').screenshot({ path: path.join(SHOTS, `subagents-strip-${scheme}.png`) });
                await strip.screenshot({ path: path.join(SHOTS, `subagents-strip-crop-${scheme}.png`) });
            }
            // The list folds to one line; the chat reference's View opens it again.
            await details.locator('#ingot-sa-close').click();
            await strip.locator('#ingot-subagents-toggle').click();
            await expect(strip.locator('.ingot-sa-row')).toHaveCount(0);
            await refs.first().locator('.ingot-chat-subref-view').click();
            await expect(strip.locator('.ingot-sa-row')).toHaveCount(2);
            // Open as tab is still there for a full view.
            await strip.locator('.ingot-sa-row').nth(1).click();
            await details.locator('#ingot-sa-open-tab').click();
            await expect(page.locator('.ingot-chat-tab')).toHaveCount(2);
            await expect(page.locator('#ingot-agents .ingot-agents-chat')).toContainText('nothing to change yet');
        });
    });
}
