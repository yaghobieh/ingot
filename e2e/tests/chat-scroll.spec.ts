import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

const FILES = ['a', 'b', 'c', 'd', 'e', 'f'] as const;
const LINE_COUNT = 40;

/** A long streamed turn: prose, then one edit per file, then a command that waits on the run card. */
const reply = (): string => {
    const lines = Array.from({ length: LINE_COUNT }, (_, index) => `Reply line ${index}. This line is long enough to wrap in the chat.`).join('\n');
    const edits = FILES.map(name => `<<<EDIT src/${name}.ts\nexport const ${name} = 1;\n>>>END`).join('\n');
    const run = `<tool_call>\n${JSON.stringify({ name: 'ingot/run', arguments: { command: 'node -e "console.log(1)"' } })}\n</tool_call>`;
    return `${lines}\n${edits}\n${run}`;
};

const threadBox = (page: Page): Promise<{ top: number; height: number; client: number }> =>
    page.locator('.ingot-agents-chat').evaluate(el => ({ top: el.scrollTop, height: el.scrollHeight, client: el.clientHeight }));

/** IDEA-258: scrolling up stays put while a long turn streams, and many edits share one preview tab. */
test('keeps the reading position and one preview tab through a long turn', async ({ page }) => {
    test.setTimeout(180_000);
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-scroll-')));
    fs.mkdirSync(path.join(dir, 'src'));
    for (const name of FILES) {
        fs.writeFileSync(path.join(dir, 'src', `${name}.ts`), `export const ${name} = 0;\n`);
    }
    const server = await startFakeOllama(reply, { delayMs: 15, chunkSize: 24 });
    try {
        await openIngot(page, dir);
        await dismissNotifications(page);
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await page.locator('#ingot-composer-input').fill('Update the constants');
        await page.locator('#ingot-composer-input').press('Enter');

        await expect(page.locator('.ingot-agents-chat')).toContainText('Reply line 0');
        await expect.poll(async () => {
            const box = await threadBox(page);
            return box.height - box.client;
        }).toBeGreaterThan(80);
        await page.locator('.ingot-agents-chat').evaluate(el => { el.scrollTop = 0; });
        const before = await threadBox(page);
        expect(before.height - before.client).toBeGreaterThan(80);
        expect(before.top).toBeLessThan(5);

        await expect(page.locator('#ingot-agents')).toContainText('Edit src/f.ts', { timeout: 60_000 });
        await expect(page.locator('#ingot-approval-run')).toBeVisible();
        const after = await threadBox(page);
        expect(after.top).toBeLessThan(5);
        expect(after.height - after.client).toBeGreaterThan(80);

        const tabs = page.locator('#theia-main-content-panel .lm-TabBar-tab');
        await expect(tabs.filter({ hasText: 'f.ts' })).toHaveCount(1);
        for (const name of FILES.slice(0, FILES.length - 1)) {
            await expect(tabs.filter({ hasText: `${name}.ts` })).toHaveCount(0);
        }
        await expect(page.locator('#theia-dialog-shell .dialogBlock')).toHaveCount(0);
    } finally {
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    }
});
