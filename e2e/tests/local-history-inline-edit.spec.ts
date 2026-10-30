import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/** IDEA-262: Cmd+K inline edit on a selection, and Local History (.ingot/history) with diff and restore. */
const ORIGINAL = [
    'export function add(a: number, b: number): number {',
    '    return a + b;',
    '}',
    '',
    'export function sub(a: number, b: number): number {',
    '    return a - b;',
    '}',
    ''
].join('\n');
const SAVED_NOTE = '// saved by e2e';
const INLINE_MARKER = 'You are Ingot inline edit.';
const REPLACEMENT = [
    'export function add(a: number, b: number): number {',
    '    // Adds two numbers.',
    '    return a + b;',
    '}'
].join('\n');

const editor = (page: Page) => page.locator('.theia-editor .monaco-editor:not(.monaco-diff-editor .monaco-editor)').first();
const inlinePrompt = (page: Page) => page.locator('#ingot-inline-edit');
const historyView = (page: Page) => page.locator('.ingot-local-history');

const openMath = async (page: Page): Promise<void> => {
    await expect(async () => {
        await page.keyboard.press('Escape');
        await page.keyboard.press('Control+p');
        await expect(page.locator('.quick-input-widget input')).toBeVisible({ timeout: 2_000 });
        await page.locator('.quick-input-widget input').fill('math.ts');
        await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'math.ts' }).first().click({ timeout: 3_000 });
        await expect(editor(page).locator('.view-lines')).toContainText('export function sub', { timeout: 3_000 });
    }).toPass({ timeout: 40_000 });
};

/** Selects lines 1-3 with the keyboard (the selection ends at the start of line 4). */
const selectAdd = async (page: Page): Promise<void> => {
    await editor(page).locator('.view-lines').click();
    await page.keyboard.press('Control+Home');
    for (let i = 0; i < 3; i++) {
        await page.keyboard.press('Shift+ArrowDown');
    }
};

test.describe('IDEA-262 local history and inline edit', () => {
    test.setTimeout(180_000);
    let project: string;
    let file: string;
    let server: FakeOllama;

    test.beforeEach(async () => {
        project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-history-')));
        fs.mkdirSync(path.join(project, 'src'));
        file = path.join(project, 'src', 'math.ts');
        fs.writeFileSync(file, ORIGINAL);
        server = await startFakeOllama(system => system.startsWith(INLINE_MARKER) ? `\`\`\`ts\n${REPLACEMENT}\n\`\`\`` : 'OK', { delayMs: 0 });
    });

    test.afterEach(async () => {
        await server.close();
        fs.rmSync(project, { recursive: true, force: true });
    });

    test('Cmd+K proposes an inline diff, and local history diffs and restores versions', async ({ page }) => {
        await openIngot(page, project);
        await dismissNotifications(page);
        await setAppearance(page, 'light');
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');

        await openMath(page);
        await editor(page).locator('.view-lines').click();
        await page.keyboard.press('Control+End');
        await page.keyboard.type(SAVED_NOTE);
        await page.keyboard.press('Control+s');
        await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain(SAVED_NOTE);

        // Inline edit: select, Ctrl+K (Cmd+K on macOS), instruction, Enter, then Accept in the editor.
        await selectAdd(page);
        await actUntilVisible(() => page.keyboard.press('Control+k'), inlinePrompt(page));
        await expect(page.locator('.ingot-inline-edit-range').first()).toBeVisible();
        await page.locator('#ingot-inline-edit-input').fill('Document what add does');
        await shot(page, 'inline-edit-prompt-light.png');
        await page.keyboard.press('Enter');
        await expect(inlinePrompt(page)).toHaveCount(0);
        const accept = page.locator('.ingot-hunk-accept').first();
        await expect(accept).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('.ingot-hunk-reject').first()).toBeVisible();
        await expect(editor(page).locator('.view-lines')).toContainText('Adds two numbers.');
        await expect(page.locator('.ingot-diff-removed-line, .ingot-diff-added-line').first()).toBeAttached();
        await shot(page, 'inline-edit-diff-light.png');
        expect(server.requests.at(-1)?.user).toContain('INSTRUCTION: Document what add does');
        expect(server.requests.at(-1)?.user).toContain('<<<SELECTED CODE\nexport function add');
        // The browser app auto-saves after a delay: the proposal reaches disk while still in review, and must not
        // be listed as a plain save.
        await expect.poll(() => fs.readFileSync(file, 'utf8'), { timeout: 10_000 }).toContain('// Adds two numbers.');
        await accept.click();
        await expect(page.locator('.ingot-hunk-accept')).toHaveCount(0);
        await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('// Adds two numbers.');

        // Local History: the original, the save and the inline edit are listed; diff and restore the original.
        await editor(page).locator('.view-lines').click();
        await actUntilVisible(() => page.keyboard.press('Control+Alt+Shift+H'), historyView(page));
        const entries = historyView(page).locator('.ingot-lh-entry');
        await expect(entries).toHaveCount(3);
        await expect(entries.nth(0)).toContainText('Inline edit');
        await expect(entries.nth(0)).toHaveAttribute('data-source', 'inline-edit');
        await expect(entries.nth(1)).toContainText('Saved');
        await expect(entries.nth(2)).toContainText('Original');
        await entries.nth(2).click();
        await expect(historyView(page)).toHaveClass(/ingot-lh-has-version/);
        await expect(historyView(page).locator('.monaco-diff-editor')).toBeVisible();
        await expect(historyView(page).locator('.ingot-lh-compare')).toContainText('Original');
        await shot(page, 'local-history-light.png');
        await page.locator('#ingot-lh-restore').click();
        await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe(ORIGINAL);
        await expect(entries).toHaveCount(4);
        await expect(entries.nth(0)).toContainText('Saved');

        const historyDir = path.join(project, '.ingot', 'history');
        expect(fs.readFileSync(path.join(historyDir, '.gitignore'), 'utf8')).toBe('*\n');
        const folders = fs.readdirSync(historyDir).filter(name => name.startsWith('src_math.ts-'));
        expect(folders).toHaveLength(1);
        const index = JSON.parse(fs.readFileSync(path.join(historyDir, folders[0], 'index.json'), 'utf8')) as { path: string; entries: unknown[] };
        expect(index.path).toBe('src/math.ts');
        expect(index.entries).toHaveLength(4);

        // Dark theme: the same views with theme tokens.
        await setAppearance(page, 'dark');
        await expect(page.locator('body')).toHaveClass(/ingot-dark/);
        await entries.nth(1).click();
        await expect(historyView(page).locator('.ingot-lh-compare')).toContainText('Inline edit');
        await shot(page, 'local-history-dark.png');
        await openMath(page);
        await selectAdd(page);
        await actUntilVisible(() => page.keyboard.press('Control+k'), inlinePrompt(page));
        await page.locator('#ingot-inline-edit-input').fill('Document what add does');
        await shot(page, 'inline-edit-prompt-dark.png');
        await page.keyboard.press('Escape');
        await expect(inlinePrompt(page)).toHaveCount(0);
        await setAppearance(page, 'light');
    });
});
