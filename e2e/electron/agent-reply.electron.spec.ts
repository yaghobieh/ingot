import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { launchDesktop, readClipboard, type DesktopApp } from '../src/electron.utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/** IDEA-100 in the desktop app: Markdown replies, rules applied silently (no chips), file drop → inline chip. */
const REPLY = [
    '### Branching model',
    'This is the **Git** workflow, not executable code.',
    '',
    '#### Branches',
    '| Branch | Purpose |',
    '|---|---|',
    '| `master` | Production |',
    '| `release/0.1.0` | Integration |',
    '',
    '- one ticket',
    '- one branch',
    '',
    '```ts',
    'const answer = 42;',
    '```',
    '',
    '> The next heading defines the commit format.'
].join('\n');

const composer = (page: Page) => page.locator('#ingot-composer-input');

const makeProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-reply-')));
    fs.writeFileSync(path.join(dir, 'AGENTS.md'), '# Rules\nNever touch master directly.\n');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'cart.ts'), 'export const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);\n');
    return dir;
};

test.describe('IDEA-100 agent replies (desktop)', () => {
    let dir: string;
    let desktop: DesktopApp;
    let server: FakeOllama;
    test.beforeEach(async () => {
        dir = makeProject();
        server = await startFakeOllama(() => REPLY);
        desktop = await launchDesktop(dir);
    });
    test.afterEach(async () => {
        await desktop?.close();
        await server?.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('renders Markdown with a header row and a collapsible Read rules step; no auto-attached chips', async () => {
        const { app, page } = desktop;
        await connectOllama(page, server);
        if (!await composer(page).isVisible()) {
            await page.locator('#ingot-rs-agents').click();
        }
        await pickModel(page, 'ollama-local');
        await composer(page).click();
        await page.keyboard.type('Tell what this code is doing');
        await page.keyboard.press('Enter');

        const reply = page.locator('#ingot-agents .ingot-chat-agent').last();
        const md = reply.locator('.ingot-md');
        await expect(md.locator('h3')).toHaveText('Branching model');
        await expect(md.locator('strong')).toHaveText('Git');
        await expect(md.locator('h4')).toHaveText('Branches');
        await expect(md.locator('table tr')).toHaveCount(3);
        await expect(md.locator('td code').first()).toHaveText('master');
        await expect(md.locator('ul li')).toHaveCount(2);
        await expect(md.locator('blockquote')).toContainText('commit format');
        await expect(md.locator('.ingot-md-code code')).toContainText('const answer = 42;');
        await expect(md).not.toContainText('**');
        await expect(reply.locator('.ingot-chat-agent-head')).toContainText('Ingot');

        // Copy button on code blocks.
        await md.locator('.ingot-md-copy').click();
        await expect.poll(() => readClipboard(app)).toBe('const answer = 42;');

        // Rules apply silently: no chips on the message or in the composer; they show in "Read rules".
        await expect(page.locator('#ingot-agents .ingot-chat-user').last().locator('.ingot-chip')).toHaveCount(0);
        await expect(page.locator('#ingot-composer-input .ingot-chip')).toHaveCount(0);
        const read = page.locator('#ingot-agents .ingot-chat-read').last();
        await expect(read).toContainText('Read rules');
        await expect(read).toContainText('AGENTS.md');
        await read.locator('.ingot-chat-read-row').click();
        await expect(read.locator('.ingot-chat-read-list li')).toContainText(['AGENTS.md']);
        if (process.env.SHOTS_DIR) {
            await page.screenshot({ path: path.join(process.env.SHOTS_DIR, 'electron-agent-reply.png') });
        }
    });

    test('dropping a project file into the composer inserts an inline file chip at the drop point', async () => {
        const { page } = desktop;
        if (!await composer(page).isVisible()) {
            await page.locator('#ingot-rs-agents').click();
        }
        await composer(page).click();
        await page.keyboard.type('explain  please');
        const uri = `file://${path.join(dir, 'src', 'cart.ts')}`;
        await composer(page).evaluate((el, fileUri) => {
            const text = el.firstChild as Text;
            const range = document.createRange();
            range.setStart(text, 'explain '.length);
            const box = range.getBoundingClientRect();
            const data = new DataTransfer();
            data.setData('theia-editor-dnd', fileUri);
            el.dispatchEvent(new DragEvent('dragover', { dataTransfer: data, bubbles: true, cancelable: true, clientX: box.left, clientY: box.top + 4 }));
            el.dispatchEvent(new DragEvent('drop', { dataTransfer: data, bubbles: true, cancelable: true, clientX: box.left, clientY: box.top + 4 }));
        }, uri);
        const chip = composer(page).locator('.ingot-chip-file');
        await expect(chip).toHaveCount(1);
        await expect(chip.locator('.ingot-chip-label')).toHaveText('cart.ts');
        const order = await composer(page).evaluate(el => Array.from(el.childNodes)
            .map(n => n instanceof HTMLElement && n.dataset.chipId ? '[chip]' : (n.textContent ?? '').replace(/\u00a0/g, ' ').trim())
            .filter(Boolean).join(' '));
        expect(order).toBe('explain [chip] please');
    });
});
