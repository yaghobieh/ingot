import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { openIngot, runCommand } from '../src/app.utils';
import { FIXTURE_WORKSPACE } from '../src/e2e.consts';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama, modelsPanel } from '../src/models.e2e-utils';
import { restoreFromHead } from '../src/git-restore';

const MATH = path.join(FIXTURE_WORKSPACE, 'src', 'math.ts');
const SECRET = path.join(FIXTURE_WORKSPACE, 'src', 'secret.ts');
const IGNORE_FILE = path.join(FIXTURE_WORKSPACE, '.ingotignore');
const TYPED = 'export function sub';
const COMPLETION = 'tract(a: number, b: number): number {';
const NEXT_LINE = 'export const GREETING';
/** Line of `NEXT_LINE` in the fixture's math.ts. */
const NEXT_LINE_NUMBER = 9;
/** Set to save screenshots of the feature (e.g. `.ingot-tmp/shots`). */
const SHOTS_DIR = process.env.INGOT_SHOTS_DIR;
/** An empty editor area, so no tooltip covers the code in screenshots. */
const SHOT_MOUSE = { x: 600, y: 520 };
const QUIET_MS = 2_000;
/** Monaco auto-closes the bracket and a real model repeats the opening one, as Codestral did in a live run. */
const MID_LINE_TYPED = 'export function sum(';
const MID_LINE_REPLY = '(a: number, b: number): number {';

/** The fake model plays Tab: ghost text plus a next edit after `export function sub`, nothing elsewhere. */
const reply = (system: string, user: string): string => {
    if (!system.includes('Ingot Tab')) {
        return '';
    }
    if (user.includes(`${MID_LINE_TYPED}<CURSOR>)`)) {
        return MID_LINE_REPLY;
    }
    return user.includes(`${TYPED}<CURSOR>`) ? `${COMPLETION}\n<<NEXT>> ${NEXT_LINE} = 'hello ingot';` : '';
};

const ghost = (page: Page) => page.locator('.ghost-text-decoration, .ghost-text').first();
const hint = (page: Page) => page.locator('.ingot-tab-next-hint');
const targetLine = (page: Page) => page.locator('.ingot-tab-next-line');
const tabStatus = (page: Page) => page.locator('#theia-statusBar [id$="ingot-tab-status"]');
const tabRequests = (server: FakeOllama) => server.requests.filter(r => r.system.includes('Ingot Tab'));

const shot = async (page: Page, name: string): Promise<void> => {
    if (SHOTS_DIR) {
        fs.mkdirSync(SHOTS_DIR, { recursive: true });
        await page.mouse.move(SHOT_MOUSE.x, SHOT_MOUSE.y);
        await page.screenshot({ path: path.join(SHOTS_DIR, `tab-${name}.png`) });
    }
};

const openFile = async (page: Page, name: string): Promise<void> => {
    const file = page.locator('#files').getByText(name, { exact: true });
    if (!await file.isVisible()) {
        await page.locator('#files').getByText('src', { exact: true }).click();
    }
    await file.dblclick();
    await page.locator('.lm-TabBar-tab.lm-mod-current', { hasText: name }).first().waitFor();
    await page.locator('.monaco-editor .view-lines:visible').first().click();
};

const typeOnNewLastLine = async (page: Page, text: string): Promise<void> => {
    await page.keyboard.press('Control+End');
    await page.keyboard.press('Enter');
    await page.keyboard.type(text);
};

const setTheme = async (page: Page, id: 'light' | 'dark'): Promise<void> => {
    await runCommand(page, 'Welcome to Ingot');
    await page.locator(`#ingot-theme-${id}`).click();
    await page.locator('.lm-TabBar-tab', { hasText: 'math.ts' }).first().click();
};

const connectTab = async (page: Page, server: FakeOllama): Promise<void> => {
    await openIngot(page);
    await connectOllama(page, server);
    await modelsPanel(page).locator('#ingot-autocomplete-model').selectOption('ollama-local');
    // Controlled by the preference, so it only flips once the setting is saved.
    const enabled = modelsPanel(page).locator('#ingot-tab-enabled');
    if (!await enabled.isChecked()) {
        await enabled.click();
    }
    await expect(enabled).toBeChecked();
    await expect(tabStatus(page)).toHaveText(/\bTab\s*$/);
};

test.describe('IDEA-285 Tab next-edit prediction', () => {
    let server: FakeOllama;

    test.beforeEach(async () => { server = await startFakeOllama(reply); });
    test.afterEach(async () => {
        await server.close();
        restoreFromHead(MATH);
        fs.rmSync(SECRET, { force: true });
        fs.rmSync(IGNORE_FILE, { force: true });
    });

    test('ghost text, Ctrl+Right takes a word, Tab accepts, Tab jumps to the next edit and Esc dismisses', async ({ page }) => {
        await connectTab(page, server);
        await openFile(page, 'math.ts');
        await setTheme(page, 'light');
        await typeOnNewLastLine(page, TYPED);

        await expect(ghost(page)).toBeVisible({ timeout: 15_000 });
        const sent = tabRequests(server).at(-1);
        expect(sent?.user).toContain('File: src/math.ts');
        expect(sent?.user).toContain(`${TYPED}<CURSOR>`);
        await shot(page, 'ghost-light');

        await page.keyboard.press('Control+ArrowRight');
        await expect(page.locator('.view-lines')).toContainText('export function subtract');
        await page.keyboard.press('Tab');
        await expect(page.locator('.view-lines')).toContainText(`${TYPED}${COMPLETION}`);

        // Accepting the prediction shows where the next edit is.
        await expect(hint(page)).toHaveCount(2);
        await expect(page.locator('.view-lines')).toContainText(`next edit at line ${NEXT_LINE_NUMBER}`);
        await expect(page.locator('.view-lines')).toContainText('Tab to jump here');
        await expect(targetLine(page)).toHaveCount(1);
        await shot(page, 'next-edit-light');

        const before = tabRequests(server).length;
        await page.keyboard.press('Tab');
        await expect(hint(page)).toHaveCount(0);
        await expect(page.locator('#theia-statusBar [id$="editor-status-cursor-position"]')).toHaveText(`${NEXT_LINE_NUMBER}:1`);
        // The jump asks Tab again, now at the next-edit location.
        await expect.poll(() => tabRequests(server).length).toBeGreaterThan(before);
        expect(tabRequests(server).at(-1)?.user).toContain(`<CURSOR>${NEXT_LINE}`);

        // Hiding the editor drops the hint, so the theme switches before the next round.
        await setTheme(page, 'dark');
        await typeOnNewLastLine(page, TYPED);
        await expect(ghost(page)).toBeVisible({ timeout: 15_000 });
        await shot(page, 'ghost-dark');
        await page.keyboard.press('Tab');
        await expect(hint(page)).toHaveCount(2);
        await shot(page, 'next-edit-dark');
        await page.keyboard.press('Escape');
        await expect(hint(page)).toHaveCount(0);
        await setTheme(page, 'light');
    });

    test('fills in around an auto-closed bracket without doubling it', async ({ page }) => {
        await connectTab(page, server);
        await openFile(page, 'math.ts');
        await typeOnNewLastLine(page, MID_LINE_TYPED);
        await expect(ghost(page)).toBeVisible({ timeout: 15_000 });
        await page.keyboard.press('Tab');
        await expect(page.locator('.view-lines')).toContainText('export function sum(a: number, b: number): number {');
        await expect(page.locator('.view-lines')).not.toContainText('sum((');
        await expect(page.locator('.view-lines')).not.toContainText('{)');
    });

    test('never sends a file matched by .ingotignore, and the setting turns Tab off', async ({ page }) => {
        fs.writeFileSync(IGNORE_FILE, '# never leaves this machine\nsrc/secret.ts\n');
        fs.writeFileSync(SECRET, 'export const TOKEN = 1;\n');
        await connectTab(page, server);

        await openFile(page, 'secret.ts');
        await typeOnNewLastLine(page, TYPED);
        await page.waitForTimeout(QUIET_MS);
        await expect(ghost(page)).toHaveCount(0);
        expect(tabRequests(server)).toHaveLength(0);

        await runCommand(page, 'Ingot: Toggle Tab Completions');
        await expect(tabStatus(page)).toHaveText(/Tab off/);
        await openFile(page, 'math.ts');
        await typeOnNewLastLine(page, TYPED);
        await page.waitForTimeout(QUIET_MS);
        expect(tabRequests(server)).toHaveLength(0);

        await tabStatus(page).click();
        await expect(tabStatus(page)).toHaveText(/\bTab\s*$/);
    });
});
