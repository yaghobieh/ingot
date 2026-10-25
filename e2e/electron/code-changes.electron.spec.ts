import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { launchDesktop, type DesktopApp } from '../src/electron.utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/** IDEA-102 in the desktop app: agent edits stream into the editor, become code-change blocks and are reviewed hunk by hunk. */
const ORIGINAL = [
    'export interface Item { id: string; price: number }',
    'export const total = (items: Item[]) => items.reduce((a, b) => a + b.price, 0);',
    '',
    ...Array.from({ length: 14 }, (_, i) => `export const helper${i} = (n: number) => n + ${i};`),
    ''
].join('\n');
const EDITED = [
    'export interface Item { id: string; price: number; qty: number }',
    'export const total = (items: Item[]) => items.reduce((a, b) => a + b.price * b.qty, 0);',
    '',
    ...Array.from({ length: 14 }, (_, i) => `export const helper${i} = (n: number) => n + ${i};`),
    'export const count = (items: Item[]) => items.reduce((a, b) => a + b.qty, 0);',
    ''
].join('\n');
const REPLY = `### Quantities in the cart\nAdds \`qty\` and a \`count\` helper.\n\n<<<EDIT src/cart.ts\n${EDITED}>>>END\n`;

const SHOTS = process.env.INGOT_SHOTS;
const shot = async (page: Page, name: string): Promise<void> => {
    if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, name) });
    }
};

test.describe('IDEA-102 code-change blocks (desktop)', () => {
    let dir: string;
    let file: string;
    let desktop: DesktopApp;
    let server: FakeOllama;
    test.beforeEach(async () => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-reply-')));
        fs.mkdirSync(path.join(dir, 'src'));
        file = path.join(dir, 'src', 'cart.ts');
        fs.writeFileSync(file, ORIGINAL);
        server = await startFakeOllama(() => REPLY);
        desktop = await launchDesktop(dir);
    });
    test.afterEach(async () => {
        await desktop?.close();
        await server?.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const ask = async (page: Page, text: string): Promise<void> => {
        const composer = page.locator('#ingot-composer-input');
        if (!await composer.isVisible()) {
            await page.locator('#ingot-rs-agents').click();
        }
        await composer.click();
        await page.keyboard.type(text);
        await page.keyboard.press('Enter');
    };

    test('streams live, then per-hunk Accept / Reject in the editor and the block, ⌥↓ navigation and Revert to here', async () => {
        const { page } = desktop;
        await connectOllama(page, server);
        if (!await page.locator('#ingot-composer-input').isVisible()) {
            await page.locator('#ingot-rs-agents').click();
        }
        await pickModel(page, 'ollama-local');
        await ask(page, 'Add quantities to the cart');

        const block = page.locator('#ingot-agents .ingot-change-block');
        // While the edit streams: "Writing…", the animated blue </> on the block and in the editor gutter.
        await expect(block.locator('.ingot-change-status')).toHaveText('Writing…', { timeout: 15_000 });
        await expect(block.locator('.ingot-mark-blue.ingot-mark-loop')).toBeVisible();
        await expect(page.locator('.monaco-editor .ingot-gutter-mark-live').first()).toBeVisible();
        await shot(page, '14-change-streaming.png');

        await expect(block.locator('.ingot-change-status')).toHaveText('Review', { timeout: 15_000 });
        await expect(block.locator('.ingot-mark-blue.ingot-mark-still')).toBeVisible();
        await expect(block.locator('.ingot-change-name')).toHaveText('cart.ts');
        await expect(block.locator('.ingot-change-stats')).toHaveText('+3 −2');
        await expect(block.locator('.ingot-change-hunk-bar')).toHaveCount(2);
        await expect(block.locator('.ingot-change-row.added').first()).toBeVisible();
        await expect(page.locator('#ingot-changes-summary')).toContainText('1 file changed · 2 changes');
        await expect(page.locator('.ingot-hunk-accept')).toHaveCount(2);
        await expect(page.locator('.ingot-agent-edit-bar')).toContainText('cart.ts');
        await expect(page.locator('.monaco-editor .ingot-gutter-mark').first()).toBeVisible();
        // Nothing is written to disk until decided.
        expect(fs.readFileSync(file, 'utf8')).toBe(ORIGINAL);
        await shot(page, '15-change-review.png');

        // ⌥↓ / ⌥↑ jump between hunks (line 1 and line 18).
        await page.locator('.monaco-editor .view-lines').first().click();
        await page.keyboard.press('Meta+ArrowUp');
        await page.keyboard.press('Alt+ArrowDown');
        await expect(page.locator('#theia-statusBar')).toContainText(/(?<!\d)18:1\b/);
        await page.keyboard.press('Alt+ArrowUp');
        await expect(page.locator('#theia-statusBar')).toContainText(/(?<!\d)1:1\b/);

        // Accept the first hunk in the editor (CodeLens row), reject the second in the block.
        await page.locator('.ingot-hunk-accept').first().click();
        await expect(block.locator('.ingot-change-hunk-bar').first()).toContainText('Accepted');
        await expect(page.locator('.ingot-hunk-accept')).toHaveCount(1);
        await block.locator('.ingot-change-hunk-btn:not(.accept)').click();
        await expect(block.locator('.ingot-change-status')).toHaveText('Partly accepted');
        await expect(page.locator('#ingot-changes-bar')).toBeHidden();
        await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('qty: number }');
        expect(fs.readFileSync(file, 'utf8')).not.toContain('export const count');
        await expect(page.locator('#ingot-agents')).toContainText('Review finished: 1 of 1 change(s) kept.');

        // Revert to here on the question: the file goes back and the reply is dropped.
        await page.locator('#ingot-revert-0').click();
        await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe(ORIGINAL);
        await expect(block).toHaveCount(0);

        // Ask again and keep everything with Accept All.
        await ask(page, 'Add quantities to the cart, again');
        await expect(block.locator('.ingot-change-status')).toHaveText('Review', { timeout: 20_000 });
        await page.locator('#ingot-changes-accept-all').click();
        await expect(block.locator('.ingot-change-status')).toHaveText('Accepted');
        await expect.poll(() => fs.readFileSync(file, 'utf8')).toBe(EDITED);
        await shot(page, '16-change-accepted.png');
    });
});
