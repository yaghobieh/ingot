import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot, signOutIfSignedIn } from '../src/app.utils';
import { signInToIngot } from '../src/account.e2e-utils';
import { makeToolsProject, shot } from '../src/agent-tools.e2e-utils';
import { openChat, pickMode, pickModel } from '../src/chat.e2e-utils';
import { PRO_PLUS_PLAN } from '../src/e2e.consts';
import { startFakeIngotServer, type FakeIngotServer } from '../src/fake-ingot-server';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pinZaprexDesktop, unpinZaprexDesktop } from '../src/zaprex.e2e-utils';

/**
 * The title bar T-rex ("Hand off to Rex") is ONE button, shown only on PRO+ (admins count) and only while the current
 * agent run is heavy (many files, a multi-step plan, a long run). Idle chats, light runs and other plans never see it.
 */
const HAND_OFF = 'Hand off to Rex';
const HEAVY_PROMPT = 'add a CSV export to the File menu';
const LIGHT_PROMPT = 'fix the typo in the greeting';
const LIGHT = 'Fixed the typo.';
const edit = (file: string, body: string): string => `<<<EDIT ${file}\n${body}\n>>>END\n`;
const HEAVY = [
    'PLAN:', '- Add the export service', '- Wire the File menu', '- Write unit tests for the export', '- Update the README', '',
    'Building the CSV export.', '',
    // Prose before the edit keeps the run streaming while the title bar is checked.
    ...Array.from({ length: 40 }, (_, i) => `Step note ${i + 1}: the export keeps the column order, quotes commas and escapes quotes in every cell.`), '',
    edit('src/export.ts', 'export const toCsv = (rows: string[][]): string => rows.map(r => r.join(",")).join("\\n");'),
    'Done.'
].join('\n');
const ZAPREX = ['Writing the tests.', '', edit('src/export.test.ts', '// ZAPREX-TEST'), 'Tests written.'].join('\n');

test.describe('Hand off to Rex (title bar T-rex)', () => {
    test.setTimeout(150_000);
    let account: FakeIngotServer;
    let models: FakeOllama;
    let dir: string;

    test.beforeEach(async () => {
        account = await startFakeIngotServer();
        pinZaprexDesktop(false);
        dir = makeToolsProject('ingot-rex-');
        fs.mkdirSync(path.join(dir, 'src'));
        models = await startFakeOllama((_system, user) => user.includes('You are Zaprex') ? ZAPREX : user.includes(HEAVY_PROMPT) ? HEAVY : LIGHT, { delayMs: 60, chunkSize: 24 });
    });

    test.afterEach(async ({ page }) => {
        await signOutIfSignedIn(page).catch(() => undefined);
        await account.close();
        await models.close();
        unpinZaprexDesktop();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const trex = (page: Page) => page.locator('.ingot-tb-window-actions .ingot-tb-zaprex');
    const lastReply = (page: Page) => page.locator('#ingot-agents .ingot-chat-agent').last();

    const start = async (page: Page): Promise<void> => {
        await openIngot(page, dir);
        await dismissNotifications(page);
        await expect(page.locator('#status-bar-ingot-account-status')).toBeVisible();
        await signOutIfSignedIn(page);
        await expect(page.locator('.ingot-tb-window-actions')).toBeVisible();
        // Signed out: no T-rex.
        await expect(trex(page)).toHaveCount(0);
        await signInToIngot(page);
        await connectOllama(page, models);
        await openChat(page);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await pickMode(page, 'agent');
    };

    const send = async (page: Page, text: string): Promise<void> => {
        await page.locator('#ingot-composer-input').fill(text);
        await page.locator('#ingot-composer-input').press('Enter');
    };

    test('PRO+ gets exactly one T-rex, labelled "Hand off to Rex", only while a run is heavy', async ({ page }) => {
        account.plan = PRO_PLUS_PLAN;
        await start(page);
        // Idle chat: hidden.
        await expect(trex(page)).toHaveCount(0);

        // A light run: hidden while it runs and after.
        await send(page, LIGHT_PROMPT);
        await expect(lastReply(page)).toContainText(LIGHT, { timeout: 30_000 });
        await expect(trex(page)).toHaveCount(0);

        // A heavy run (a four-step plan): one T-rex while it runs.
        await send(page, HEAVY_PROMPT);
        await expect(trex(page).first()).toBeVisible({ timeout: 30_000 });
        await expect(trex(page)).toHaveCount(1);
        await expect(page.locator('#ingot-tb-zaprex')).toHaveAttribute('title', HAND_OFF);
        await expect(page.locator('#ingot-tb-zaprex')).toHaveAttribute('aria-label', HAND_OFF);
        await expect(page.getByRole('button', { name: HAND_OFF })).toHaveCount(1);
        // Small and transparent like the other title bar icons.
        expect((await trex(page).boundingBox())?.width ?? 0).toBeLessThanOrEqual(28);
        expect(await trex(page).evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');
        await shot(page, 'rex-handoff-heavy-run.png');

        // The run ends: hidden again.
        await expect(page.locator('#ingot-agents')).toContainText('Done.', { timeout: 60_000 });
        await expect(trex(page)).toHaveCount(0, { timeout: 30_000 });
    });

    test('clicking "Hand off to Rex" hands one scoped piece of the run to Zaprex', async ({ page }) => {
        account.plan = PRO_PLUS_PLAN;
        await start(page);
        await send(page, HEAVY_PROMPT);
        await page.getByRole('button', { name: HAND_OFF }).click({ timeout: 30_000 });
        await expect(page.locator('#ingot-agents .ingot-chat-subref.zaprex')).toContainText('Taking a piece in Harmony mode: Write unit tests for the export');
        await expect(page.locator('#ingot-subagents .ingot-sa-row .ingot-sa-zaprex')).toHaveCount(1);
    });

    test('PRO (not PRO+) never sees it, even on a heavy run', async ({ page }) => {
        account.plan = 'pro';
        await start(page);
        await send(page, HEAVY_PROMPT);
        await expect(page.locator('#ingot-agents')).toContainText('Step note 3', { timeout: 30_000 });
        await expect(trex(page)).toHaveCount(0);
        await expect(page.locator('#ingot-agents')).toContainText('Done.', { timeout: 60_000 });
        await expect(trex(page)).toHaveCount(0);
    });

    test('an admin on PRO counts as PRO+ and gets exactly one T-rex on a heavy run', async ({ page }) => {
        account.role = 'admin';
        account.plan = 'pro';
        await start(page);
        await expect(trex(page)).toHaveCount(0);
        await send(page, HEAVY_PROMPT);
        await expect(trex(page).first()).toBeVisible({ timeout: 30_000 });
        await expect(trex(page)).toHaveCount(1);
        await expect(page.locator('#ingot-tb-zaprex')).toHaveCount(1);
        await shot(page, 'rex-handoff-admin.png');
    });
});
