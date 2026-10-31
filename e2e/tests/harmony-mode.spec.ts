import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot, signOutIfSignedIn } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { openChat, pickMode, pickModel } from '../src/chat.e2e-utils';
import { makeToolsProject } from '../src/agent-tools.e2e-utils';
import { signInToIngot, startProPlusServer } from '../src/account.e2e-utils';
import type { FakeIngotServer } from '../src/fake-ingot-server';
import { pinZaprexDesktop, unpinZaprexDesktop } from '../src/zaprex.e2e-utils';

/** IDEA-180 Harmony mode: on a heavy run Zaprex offers ONE scoped piece under the T-rex; Accept runs it with a file lock. */
const SHOTS = process.env.INGOT_SCREENSHOT_DIR;
const edit = (file: string, body: string): string => `<<<EDIT ${file}\n${body}\n>>>END\n`;
const LEAD = [
    'PLAN:', '- Add the export service', '- Wire the File menu', '- Write unit tests for the export', '- Update the README', '',
    'Building the CSV export.', '',
    // Prose before the edit blocks keeps the lead streaming while the offer is accepted.
    ...Array.from({ length: 16 }, (_, i) => `Step note ${i + 1}: the export keeps the column order, quotes commas and escapes quotes in every cell of the table.`), '',
    edit('src/export.ts', 'export const toCsv = (rows: string[][]): string => rows.map(r => r.join(",")).join("\\n");\n// LEAD-EXPORT'),
    edit('src/export.test.ts', '// LEAD-TEST'),
    'Done.'
].join('\n');
const ZAPREX = ['Writing the tests.', '', edit('src/export.test.ts', '// ZAPREX-TEST\nimport { toCsv } from "./export";'), edit('src/menu.ts', '// ZAPREX-OUTSIDE'), 'Tests written.'].join('\n');

const setScheme = async (page: Page, scheme: 'light' | 'dark'): Promise<void> => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.locator('#ingot-rs-theme').click();
    await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'System' }).first().click();
    await expect(page.locator('body')).toHaveClass(new RegExp(`ingot-${scheme}`));
};

test.describe('IDEA-180 Harmony mode', () => {
    test.setTimeout(150_000);
    let dir: string;
    let server: FakeOllama;
    let account: FakeIngotServer;

    test.beforeEach(async () => {
        account = await startProPlusServer();
        // The piece runs here in Ingot, even where the Zaprex desktop app is installed.
        pinZaprexDesktop(false);
        dir = makeToolsProject('ingot-harmony-');
        fs.mkdirSync(path.join(dir, 'src'));
        // Slow stream so the offer can be accepted while the lead agent is still writing.
        server = await startFakeOllama((_system, user) => user.includes('You are Zaprex') ? ZAPREX : LEAD, { delayMs: 60, chunkSize: 24 });
    });
    test.afterEach(async ({ page }) => {
        await signOutIfSignedIn(page).catch(() => undefined);
        await account.close();
        await server.close();
        unpinZaprexDesktop();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const start = async (page: Page, scheme: 'light' | 'dark'): Promise<void> => {
        await openIngot(page, dir);
        await dismissNotifications(page);
        // The T-rex the offer sits under is a PRO+ feature.
        await signInToIngot(page);
        await setScheme(page, scheme);
        await connectOllama(page, server);
        await openChat(page);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await pickMode(page, 'agent');
        await page.locator('#ingot-composer-input').fill('add a CSV export to the File menu');
        await page.locator('#ingot-composer-input').press('Enter');
    };

    for (const scheme of ['light', 'dark'] as const) {
        test(`offers one piece under the T-rex, Accept runs it with a file lock (${scheme})`, async ({ page }) => {
            await start(page, scheme);
            const bubble = page.locator('#ingot-harmony-bubble');
            await expect(bubble).toBeVisible({ timeout: 30_000 });
            await expect(bubble.locator('#ingot-harmony-text')).toHaveText('I can write the tests for this. Hand it to me?');
            await expect(bubble).toContainText('Write unit tests for the export');
            await expect(bubble).toContainText('Harmony');
            await expect(page.locator('#ingot-tb-zaprex')).toHaveClass(/thinking/);
            expect(await page.locator('#ingot-tb-zaprex .ingot-zaprex-trex').evaluate(el => getComputedStyle(el).animationName)).toBe('ingot-trex-think');
            // The bubble hangs below the T-rex.
            const [trex, box] = await Promise.all([page.locator('#ingot-tb-zaprex').boundingBox(), bubble.boundingBox()]);
            expect(box!.y).toBeGreaterThan(trex!.y + trex!.height - 1);
            // …and is really on top (not clipped by the title bar).
            expect(await page.evaluate(({ x, y }) => !!document.elementFromPoint(x, y)?.closest('#ingot-harmony-bubble'), { x: box!.x + box!.width / 2, y: box!.y + box!.height / 2 })).toBe(true);
            expect(Math.abs((box!.x + box!.width) - (trex!.x + trex!.width + 8))).toBeLessThan(3);
            if (SHOTS) {
                fs.mkdirSync(SHOTS, { recursive: true });
                await page.screenshot({ path: path.join(SHOTS, `harmony-offer-${scheme}.png`) });
                await page.screenshot({ path: path.join(SHOTS, `harmony-offer-crop-${scheme}.png`), clip: { x: box!.x - 200, y: 0, width: box!.width + 210, height: box!.y + box!.height + 12 } });
            }
            await bubble.locator('#ingot-harmony-accept').click();
            await expect(bubble).toHaveCount(0);
            const chat = page.locator('#ingot-agents');
            await expect(chat.locator('.ingot-chat-subref.zaprex')).toContainText('Taking a piece in Harmony mode: Write unit tests for the export');
            // IDEA-181: the piece shows in the Subagents strip with the T-rex.
            await expect(page.locator('#ingot-subagents .ingot-sa-row .ingot-sa-zaprex')).toHaveCount(1);
            // The lead agent may not touch Zaprex's files; Zaprex may not touch anything else.
            await expect(chat).toContainText('Left "src/export.test.ts" to Zaprex', { timeout: 45_000 });
            // Zaprex's version of its file is the one in the editor; it never opened a file outside its piece.
            await expect(page.locator('.lm-TabBar-tab', { hasText: 'menu.ts' })).toHaveCount(0);
            // Later edits replace the one preview tab, so open Zaprex's file from the tree when it is not the current tab.
            await expect.poll(async () => {
                const tab = page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: 'export.test.ts' });
                if (await tab.count()) {
                    await tab.first().click();
                } else {
                    const files = page.locator('#files');
                    await files.getByText('src', { exact: true }).click();
                    await page.keyboard.press('ArrowRight');
                    await files.getByText('export.test.ts', { exact: true }).dblclick();
                }
                return page.locator('#theia-main-content-panel .monaco-editor .view-lines').first().textContent().catch(() => '');
            }, { timeout: 45_000 }).toContain('ZAPREX-TEST');
            await expect(chat.locator('.ingot-chat-agent').first()).not.toContainText('LEAD-TEST');
        });
    }

    test('Dismiss hides the offer and it is not offered again for that run', async ({ page }) => {
        await start(page, 'light');
        const bubble = page.locator('#ingot-harmony-bubble');
        await expect(bubble).toBeVisible({ timeout: 30_000 });
        await bubble.locator('#ingot-harmony-dismiss').click();
        await expect(bubble).toHaveCount(0);
        await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('Done.', { timeout: 45_000 });
        await expect(bubble).toHaveCount(0);
        // The run is over, so the T-rex ("Hand off to Rex") is gone too.
        await expect(page.locator('#ingot-tb-zaprex')).toHaveCount(0, { timeout: 30_000 });
        // No lock without a piece: the lead agent writes the tests itself.
        await expect.poll(() => fs.readFileSync(path.join(dir, 'src', 'export.test.ts'), 'utf8')).toContain('LEAD-TEST');
        await expect(page.locator('#ingot-agents')).not.toContainText('to Zaprex');
    });
});
