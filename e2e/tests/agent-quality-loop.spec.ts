import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import type { TraceSnapshot } from '../src/agent-quality.trace';

/**
 * IDEA-282: the loop recovers when a reply hits the output limit inside an edit block (the file is asked for
 * again instead of being lost), and the agent trace a headless run prints shows the steps and the nudge.
 */
const FILE = 'server/src/books.ts';
const BODY = "export const books = [{ id: 1, title: 'Dune' }];\nexport const findBook = (id: number) => books.find(book => book.id === id);";
const PROMPT = 'Create the books module of the library API in server/src (feature folders)';
const CUT_MARK = 'Your last reply was cut off.';
const EMPTY_PROMPT = 'List the library resources';
const EMPTY_MARK = 'Your last reply was empty.';
const EMPTY_RECOVERED = 'The library has books, authors and loans.';

const readTrace = (page: Page): Promise<TraceSnapshot | undefined> =>
    page.evaluate(() => (window as unknown as Record<string, () => TraceSnapshot | undefined>).ingotAgentTrace?.());

test.describe('agent quality loop (IDEA-282)', () => {
    test.setTimeout(180_000);
    let dir: string;
    let server: FakeOllama;

    test.beforeEach(async () => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-aq-')));
        server = await startFakeOllama((_system, user) => {
            if (user.includes(EMPTY_MARK)) {
                return EMPTY_RECOVERED;
            }
            if (user.includes(EMPTY_PROMPT)) {
                return '';
            }
            if (user.includes(CUT_MARK)) {
                return `Sending ${FILE} again.\n\n<<<EDIT ${FILE}\n${BODY}\n>>>END\n\nThe books module is written.`;
            }
            if (user.includes('books module')) {
                return `PLAN:\n- Write ${FILE}\n- Check it\n\n<<<EDIT ${FILE}\nexport const books = [{ id: 1, ti`;
            }
            return 'Done.';
        }, { delayMs: 0 });
    });

    test.afterEach(async () => {
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('asks again for a file cut off mid-edit and traces the steps', async ({ page }) => {
        await openIngot(page, dir);
        await dismissNotifications(page);
        await setAppearance(page, 'dark');
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await page.locator('#ingot-composer-input').fill(PROMPT);
        await page.locator('#ingot-composer-input').press('Enter');

        await expect(page.locator(`#ingot-review-files [data-path="${FILE}"]`)).toBeVisible({ timeout: 60_000 });
        await expect.poll(() => server.requests.some(request => request.user.includes(CUT_MARK))).toBe(true);
        expect(server.requests.find(request => request.user.includes(CUT_MARK))?.maxTokens).toBeGreaterThan(8_000);

        const trace = await readTrace(page);
        expect(trace?.steps.some(step => step.kind === 'edit' && step.target === FILE)).toBe(true);
        expect(trace?.messages.some(message => message.hidden && message.text.includes(`${FILE} was NOT saved`))).toBe(true);
        await shot(page, 'agent-quality-loop-dark.png');

        await page.locator('#ingot-changes-accept-all').click();
        await expect.poll(() => fs.existsSync(path.join(dir, FILE)) && fs.readFileSync(path.join(dir, FILE), 'utf8')).toContain('findBook');
        await setAppearance(page, 'light');
        await shot(page, 'agent-quality-loop-light.png');
    });

    test('retries an empty reply once instead of stopping', async ({ page }) => {
        await openIngot(page, dir);
        await dismissNotifications(page);
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await page.locator('#ingot-composer-input').fill(EMPTY_PROMPT);
        await page.locator('#ingot-composer-input').press('Enter');

        await expect(page.locator('.ingot-agents .ingot-chat-agent').last()).toContainText(EMPTY_RECOVERED, { timeout: 60_000 });
        await expect(page.locator('.ingot-agents .ingot-chat-agent', { hasText: '(empty reply)' })).toHaveCount(0);
        const trace = await readTrace(page);
        expect(trace?.messages.some(message => message.hidden && message.text.startsWith(EMPTY_MARK))).toBe(true);
    });
});
