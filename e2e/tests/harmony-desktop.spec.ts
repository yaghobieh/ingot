import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot, signOutIfSignedIn } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { makeToolsProject } from '../src/agent-tools.e2e-utils';
import { signInToIngot, startProPlusServer } from '../src/account.e2e-utils';
import type { FakeIngotServer } from '../src/fake-ingot-server';
import { ZAPREX_DETECT_FILE, ZAPREX_LINK_LOG } from '../src/e2e.consts';

/**
 * IDEA-185: with the Zaprex desktop app, Accept hands the piece over (zaprex:// link + loopback token). This test plays
 * the desktop app: it reads the link Ingot opened, claims the piece, streams status and posts the result.
 */
const SHOTS = process.env.INGOT_SCREENSHOT_DIR;
const edit = (file: string, body: string): string => `<<<EDIT ${file}\n${body}\n>>>END\n`;
const LEAD = [
    'PLAN:', '- Add the export service', '- Wire the File menu', '- Write unit tests for the export', '- Update the README', '',
    'Building the CSV export.', '',
    ...Array.from({ length: 16 }, (_, i) => `Step note ${i + 1}: the export keeps the column order, quotes commas and escapes quotes in every cell of the table.`), '',
    edit('src/export.ts', 'export const toCsv = (rows: string[][]): string => rows.map(r => r.join(",")).join("\\n");\n// LEAD-EXPORT'),
    'Done.'
].join('\n');

const setScheme = async (page: Page, scheme: 'light' | 'dark'): Promise<void> => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.locator('#ingot-rs-theme').click();
    await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'System' }).first().click();
    await expect(page.locator('body')).toHaveClass(new RegExp(`ingot-${scheme}`));
};
const links = (): string[] => fs.existsSync(ZAPREX_LINK_LOG) ? fs.readFileSync(ZAPREX_LINK_LOG, 'utf8').split('\n').filter(Boolean) : [];

test.describe('IDEA-185 Zaprex desktop handoff', () => {
    test.setTimeout(150_000);
    let dir: string;
    let server: FakeOllama;
    let account: FakeIngotServer | undefined;

    const prepare = async (installed: boolean): Promise<void> => {
        account = await startProPlusServer();
        dir = makeToolsProject('ingot-handoff-');
        fs.mkdirSync(path.join(dir, 'src'));
        fs.mkdirSync(path.dirname(ZAPREX_DETECT_FILE), { recursive: true });
        fs.writeFileSync(ZAPREX_DETECT_FILE, installed ? 'installed' : 'missing');
        fs.rmSync(ZAPREX_LINK_LOG, { force: true });
        server = await startFakeOllama((_system, user) => user.includes('You are Zaprex') ? 'Zaprex ran here.' : LEAD, { delayMs: 60, chunkSize: 24 });
    };
    test.afterEach(async ({ page }) => {
        await signOutIfSignedIn(page).catch(() => undefined);
        await account?.close();
        await server?.close();
        fs.rmSync(ZAPREX_DETECT_FILE, { force: true });
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const start = async (page: Page, scheme: 'light' | 'dark'): Promise<void> => {
        await openIngot(page, dir);
        await dismissNotifications(page);
        // The T-rex the offer sits under is a PRO+ feature.
        await signInToIngot(page);
        await setScheme(page, scheme);
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await page.locator('#ingot-composer-input').fill('add a CSV export to the File menu');
        await page.locator('#ingot-composer-input').press('Enter');
    };

    for (const scheme of ['light', 'dark'] as const) {
        test(`hands the piece to the desktop app, streams its status, the lead waits and reviews the result (${scheme})`, async ({ page }) => {
            await prepare(true);
            await start(page, scheme);
            const bubble = page.locator('#ingot-harmony-bubble');
            await expect(bubble).toBeVisible({ timeout: 30_000 });
            await expect(bubble.locator('#ingot-harmony-where')).toHaveText(/Runs in the Zaprex desktop app/);
            await bubble.locator('#ingot-harmony-accept').click();

            // Ingot opened zaprex://harmony?v=1&id&port&token (recorded by the test hook instead of the OS).
            await expect.poll(() => links().find(l => l.startsWith('zaprex://harmony?')), { timeout: 15_000 }).toBeTruthy();
            const q = new URL(links().find(l => l.startsWith('zaprex://harmony?'))!.replace('zaprex://harmony', 'http://x/'));
            expect(q.searchParams.get('v')).toBe('1');
            expect(q.searchParams.get('from')).toBe('ingot');
            const base = `http://127.0.0.1:${q.searchParams.get('port')}/v1/handoff/${q.searchParams.get('id')}`;
            const auth = { Authorization: `Bearer ${q.searchParams.get('token')}` };

            // A web page (Origin header) and a wrong token are refused; the desktop app claims the piece.
            expect((await fetch(base, { headers: { ...auth, Origin: 'https://zaprex.dev' } })).status).toBe(403);
            expect((await fetch(base, { headers: { Authorization: 'Bearer nope' } })).status).toBe(404);
            const claim = await fetch(base, { headers: auth });
            expect(claim.status).toBe(200);
            const piece = await claim.json() as { task: string; scope: string[]; repo: { path: string }; lead: { title: string }; source: string };
            expect(piece.source).toBe('ingot');
            expect(piece.task).toContain('Write unit tests for the export');
            expect(piece.scope).toContain('**/*.test.*');
            expect(piece.repo.path).toBe(dir);

            const post = (sub: string, body: unknown) => fetch(`${base}/${sub}`, { method: 'POST', headers: { ...auth, 'Content-Type': 'application/json' }, body: JSON.stringify(body) });
            expect((await post('status', { state: 'working', progress: 0.5, message: 'Writing export.test.ts' })).status).toBe(200);

            // The T-rex subagent row streams Zaprex's status.
            const row = page.locator('#ingot-subagents .ingot-sa-row').filter({ has: page.locator('.ingot-sa-zaprex') });
            await expect(row).toContainText('Writing export.test.ts', { timeout: 10_000 });
            await expect(row.locator('.ingot-sa-progress')).toHaveAttribute('aria-valuenow', '50');
            // The lead finishes its part, then waits for Zaprex.
            const chat = page.locator('#ingot-agents');
            await expect(chat).toContainText('Waiting for Zaprex: Tests', { timeout: 45_000 });
            if (SHOTS) {
                fs.mkdirSync(SHOTS, { recursive: true });
                await page.locator('#ingot-agents').screenshot({ path: path.join(SHOTS, `harmony-desktop-working-${scheme}.png`) });
            }

            // Edits outside the piece are refused; in-scope edits go to the review.
            expect((await post('result', { summary: 'nope', edits: [{ path: 'src/menu.ts', content: '// OUTSIDE' }] })).status).toBe(400);
            expect((await post('result', { summary: 'Added the export tests.', edits: [{ path: 'src/export.test.ts', content: '// DESKTOP-TEST\n' }] })).status).toBe(200);
            await expect(chat).toContainText('Done: Tests · 1 file(s) to review in the review bar', { timeout: 15_000 });
            // Zaprex's file is in the editor, pending review like any agent edit.
            await expect.poll(async () => {
                await page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: 'export.test.ts' }).first().click().catch(() => undefined);
                return page.locator('#theia-main-content-panel .monaco-editor .view-lines').first().textContent().catch(() => '');
            }, { timeout: 30_000 }).toContain('DESKTOP-TEST');
            expect(fs.existsSync(path.join(dir, 'src', 'menu.ts'))).toBe(false);
            // The piece ended: more posts are refused.
            expect((await post('status', { state: 'working' })).status).toBe(409);
            if (SHOTS) {
                await page.locator('#ingot-agents').screenshot({ path: path.join(SHOTS, `harmony-desktop-done-${scheme}.png`) });
            }

            // With the app installed the T-rex opens it by its deep link.
            await page.locator('#ingot-tb-zaprex').click();
            await expect.poll(links).toContain('zaprex://open?from=ingot');
        });
    }

    test('without the desktop app the offer says the piece runs here, and Get Zaprex opens the download page', async ({ page, context }) => {
        await prepare(false);
        await context.route('https://zaprex.dev/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Zaprex</title>' }));
        await start(page, 'light');
        const bubble = page.locator('#ingot-harmony-bubble');
        await expect(bubble).toBeVisible({ timeout: 30_000 });
        await expect(bubble.locator('#ingot-harmony-where')).toContainText('Runs here in Ingot');
        if (SHOTS) {
            fs.mkdirSync(SHOTS, { recursive: true });
            const box = (await bubble.boundingBox())!;
            await page.screenshot({ path: path.join(SHOTS, 'harmony-offer-no-desktop-light.png'), clip: { x: box.x - 10, y: box.y - 10, width: box.width + 20, height: box.height + 20 } });
        }
        const [popup] = await Promise.all([page.waitForEvent('popup'), bubble.locator('#ingot-harmony-get').click()]);
        expect(popup.url()).toBe('https://zaprex.dev/app?from=ingot');
        await popup.close();
        await bubble.locator('#ingot-harmony-accept').click();
        await expect(page.locator('#ingot-agents')).toContainText('Taking a piece in Harmony mode');
        // Ran here: nothing was handed to a desktop app.
        expect(links().some(l => l.startsWith('zaprex://harmony'))).toBe(false);
    });
});
