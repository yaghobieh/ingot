import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { pickMode, pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama, modelsPanel } from '../src/models.e2e-utils';

/** IDEA-77: chat tabs + History, five modes, model picker, per-chat context, memories. */
const agents = (page: Page) => page.locator('#ingot-agents');
const tabs = (page: Page) => agents(page).locator('.ingot-chat-tab');

const makeProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-chat-')));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'math.ts'), 'export const add = (a: number, b: number): number => a + b;\n');
    return dir;
};

const send = async (page: Page, text: string): Promise<void> => {
    await page.locator('#ingot-composer-input').fill(text);
    await page.locator('#ingot-composer-input').press('Enter');
};

const openMath = async (page: Page): Promise<void> => {
    await page.locator('#files').getByText('src', { exact: true }).click();
    await page.keyboard.press('ArrowRight');
    await page.locator('#files').getByText('math.ts', { exact: true }).dblclick();
    await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('export');
};

test.describe('IDEA-77 chat redesign', () => {
    let server: FakeOllama;
    let project: string;
    let reply: (system: string, user: string) => string;

    test.beforeEach(async () => {
        project = makeProject();
        reply = (_s, user) => `Echo: ${user.slice(0, 40)}`;
        server = await startFakeOllama((s, u) => reply(s, u));
    });
    test.afterEach(async () => {
        await server.close();
        fs.rmSync(project, { recursive: true, force: true });
    });

    test('chats are tabs; + and History icons; history search, pin, rename, reopen, delete; tabs survive reload', async ({ page }) => {
        await openIngot(page, project);
        await dismissNotifications(page);
        await connectOllama(page, server);
        await expect(page.locator('#ingot-agents-new')).toHaveText('');
        await expect(page.locator('#ingot-agents-new')).toHaveAttribute('aria-label', 'New chat');
        await expect(agents(page).getByText('New agent', { exact: false })).toHaveCount(0);

        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await send(page, 'First task about the cart');
        await expect(agents(page).locator('.ingot-chat-agent')).toContainText('Echo: First task');
        await page.locator('#ingot-agents-new').click();
        await send(page, 'Second task about auth');
        await expect(tabs(page)).toHaveCount(2);
        await expect(tabs(page).nth(1)).toHaveClass(/active/);
        await expect(tabs(page).nth(1).locator('.ingot-chat-tab-title')).toHaveText('Second task about auth');

        // Close the first tab: it stays in History.
        await tabs(page).first().locator('.ingot-chat-tab-close').click();
        await expect(tabs(page)).toHaveCount(1);
        await page.locator('#ingot-agents-history').click();
        const history = page.locator('#ingot-chat-history');
        await expect(history.locator('.ingot-history-row')).toHaveCount(2);
        await history.locator('#ingot-history-search').fill('cart');
        await expect(history.locator('.ingot-history-row')).toHaveCount(1);
        const row = history.locator('.ingot-history-row').first();
        await row.hover();
        await row.getByRole('button', { name: 'Pin' }).click();
        await expect(row.locator('.ingot-history-pin-mark')).toBeVisible();
        await row.getByRole('button', { name: 'Rename' }).click();
        await history.locator('.ingot-history-rename').fill('Cart work');
        await history.locator('.ingot-history-rename').press('Enter');
        await expect(row.locator('.ingot-history-title')).toHaveText('Cart work');
        await row.click();
        await expect(history).toBeHidden();
        await expect(tabs(page)).toHaveCount(2);
        await expect(agents(page).locator('.ingot-chat-tab.active .ingot-chat-tab-title')).toHaveText('Cart work');
        await expect(agents(page).locator('.ingot-chat-user')).toContainText('First task about the cart');

        // Delete the other chat from History.
        await page.locator('#ingot-agents-history').click();
        const other = history.locator('.ingot-history-row', { hasText: 'Second task' });
        await other.hover();
        await other.getByRole('button', { name: 'Delete' }).click();
        await expect(history.locator('.ingot-history-row')).toHaveCount(1);
        await page.keyboard.press('Escape');

        // Double-click renames a tab; chats persist across a reload.
        await tabs(page).first().dblclick();
        await agents(page).locator('.ingot-chat-tab-rename').fill('Cart work v2');
        await agents(page).locator('.ingot-chat-tab-rename').press('Enter');
        await page.waitForTimeout(500);
        await page.reload();
        await expect(tabs(page).first().locator('.ingot-chat-tab-title')).toHaveText('Cart work v2', { timeout: 60_000 });
    });

    test('five modes with permissions, Ctrl+. cycles, per-tab memory, Plan → Build', async ({ page }) => {
        reply = (system, user) => user.startsWith('Implement the plan') ? 'Building now.' : system.includes('implementation plan')
            ? 'PLAN:\n- Add qty to addItem\n- Update tests\n\nLow risk.' : 'Plain answer.';
        await openIngot(page, project);
        await dismissNotifications(page);
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');

        await page.locator('#ingot-composer-mode').click();
        await expect(page.locator('#ingot-mode-menu .ingot-mode-item')).toHaveCount(5);
        await expect(page.locator('#ingot-mode-menu')).toContainText('Multi-agent');
        await expect(page.locator('#ingot-mode-debug')).toContainText('terminal output');
        await page.locator('#ingot-mode-ask').click();
        await expect(page.locator('#ingot-composer-more')).toHaveAttribute('data-mode', 'ask');
        await send(page, 'What does add do?');
        await expect(agents(page).locator('.ingot-chat-agent .ingot-md').last()).toHaveText('Plain answer.');
        expect(server.requests.at(-1)?.system).toContain('Do not propose edits');
        expect(server.requests.at(-1)?.system).not.toContain('<<<EDIT');

        // Ctrl+. cycles Ask → Plan while the chat has focus.
        await page.locator('#ingot-composer-input').click();
        await page.keyboard.press('Control+.');
        await expect(page.locator('#ingot-composer-more')).toHaveAttribute('data-mode', 'plan');
        await send(page, 'Add qty support');
        await expect(agents(page).locator('.ingot-chat-plan')).toContainText('Add qty to addItem');
        await expect(page.locator('#ingot-plan-build')).toBeVisible();

        // A new tab starts in the last chosen mode; each tab keeps its own.
        await page.locator('#ingot-agents-new').click();
        await pickMode(page, 'debug');
        await tabs(page).first().click();
        await expect(page.locator('#ingot-composer-more')).toHaveAttribute('data-mode', 'plan');

        await page.locator('#ingot-plan-build').click();
        await expect(page.locator('#ingot-composer-more')).toHaveAttribute('data-mode', 'agent');
        await expect(agents(page).locator('.ingot-chat-agent .ingot-md').last()).toHaveText('Building now.');
        expect(server.requests.at(-1)?.system).toContain('<<<EDIT');
        await tabs(page).nth(1).click();
        await expect(page.locator('#ingot-composer-more')).toHaveAttribute('data-mode', 'debug');
    });

    test('model picker: families with > arrow, search, favorites, no badges, Add key, Auto, Manage models', async ({ page }) => {
        await openIngot(page, project);
        await dismissNotifications(page);
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await page.locator('#ingot-composer-model').click();
        const picker = page.locator('#ingot-model-picker');
        await expect(picker.locator('#ingot-pick-auto')).toBeVisible();
        // IDEA-91: one row per family with a '>' arrow; no speed / context / thinking / cost labels anywhere.
        await expect(picker.locator('.ingot-pick-family')).toHaveText([/Claude/, /GPT/, /Gemini/, /DeepSeek/, /Routed/, /Local/]);
        await expect(picker.locator('#ingot-pick-family-openai .codicon-chevron-right')).toBeVisible();
        await expect(picker.locator('.ingot-pick-badge')).toHaveCount(0);
        await expect(picker).not.toContainText(/Balanced|Thinking|\b1M\b|400k|200k|\$/);
        // The picker fits inside the chat panel.
        const panel = (await page.locator('#ingot-agents').boundingBox())!;
        const pickerBox = (await picker.boundingBox())!;
        expect(pickerBox.x).toBeGreaterThanOrEqual(panel.x);
        expect(pickerBox.x + pickerBox.width).toBeLessThanOrEqual(panel.x + panel.width + 1);
        await picker.locator('#ingot-pick-family-ollama').click();
        await expect(picker.locator('#ingot-pick-sub-ollama')).toContainText('Qwen2.5 Coder (local)');
        await expect(picker.locator('#ingot-pick-ollama-ollama-local .ingot-pick-addkey')).toHaveCount(0);
        await picker.locator('#ingot-pick-back').click();
        await expect(picker.locator('#ingot-pick-sub-ollama')).toHaveCount(0);
        await picker.locator('#ingot-pick-family-openai').click();
        const gpt = picker.locator('#ingot-pick-openai-gpt-5');
        await expect(gpt.locator('.ingot-pick-addkey')).toBeVisible();
        for (const brand of ['Anthropic', 'OpenAI', 'Google', 'Ollama', 'OpenRouter']) {
            await expect(picker).not.toContainText(brand);
        }
        await gpt.getByRole('button', { name: 'Favorite GPT-5' }).click();
        await picker.locator('#ingot-pick-back').click();
        await expect(picker.locator('#ingot-pick-section-favorites')).toContainText('GPT-5');
        await picker.locator('#ingot-model-search').fill('gpt-5 m');
        await expect(picker.locator('.ingot-pick-row')).toHaveCount(1);
        await expect(picker.locator('#ingot-pick-search-gpt-5-mini')).toBeVisible();
        await picker.locator('#ingot-model-search').fill('');
        await picker.locator('#ingot-pick-auto').click();
        await expect(page.locator('#ingot-composer-model')).toHaveText('Auto');
        await send(page, 'Hi auto');
        await expect(agents(page).locator('.ingot-chat-agent')).toContainText('Echo: Hi auto');
        expect(server.requests.at(-1)?.model).toBe('e2e-coder');

        await page.locator('#ingot-composer-model').click();
        await page.locator('#ingot-pick-manage').click();
        await expect(modelsPanel(page)).toBeVisible();
    });

    test('context chips, usage ring, memories (save, undo, inject, manage) and Summarize & continue', async ({ page }) => {
        reply = (system, user) => user.includes('remember') ? 'Noted.\nREMEMBER: The project uses tabs for indentation.' : user.includes('Summarize this conversation')
            ? '- Goal: big paste\n- Left: nothing' : `Echo reply: ${user.slice(0, 20)}`;
        await openIngot(page, project);
        await dismissNotifications(page);
        await connectOllama(page, server);
        await openMath(page);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');

        // The open file is not an inline chip; IDEA-267 shows it as removable auto-context above the composer instead.
        await expect(page.locator('#ingot-context-file, #ingot-context-attach-file')).toHaveCount(0);
        await expect(page.locator('#ingot-auto-chip-file')).toContainText('math.ts');
        // Idle: no context ring (never a spinner), and Send stays muted until there is text.
        await expect(page.locator('#ingot-context-ring')).toHaveCount(0);
        await expect(page.locator('#ingot-composer-send')).toBeDisabled();

        await send(page, 'Please remember how we indent');
        const saved = agents(page).locator('.ingot-chat-memory');
        await expect(saved).toContainText('Memory saved');
        await expect(saved).toContainText('tabs for indentation');
        await expect(agents(page).locator('.ingot-chat-agent .ingot-md').last()).toHaveText('Noted.');
        const dir = path.join(project, '.ingot', 'memory');
        expect(fs.readdirSync(dir).filter(f => f.endsWith('.md'))).toHaveLength(1);
        expect(fs.readFileSync(path.join(dir, '.gitignore'), 'utf8')).toContain('*');
        expect(server.requests.at(-1)?.system).not.toContain('Project files for context');
        await page.locator('#ingot-composer-more').click();
        const ring = page.locator('#ingot-context-ring');
        await expect(ring).toBeVisible();
        expect(Number(await ring.getAttribute('data-ratio'))).toBeGreaterThan(0);
        await expect(ring).toHaveAttribute('title', /tokens/);
        await page.locator('#ingot-composer-more').click();

        // The next request carries the memory silently: no chip is auto-attached to the message (IDEA-100).
        await send(page, 'What is our style?');
        await expect(agents(page).locator('.ingot-chat-agent').last()).toContainText('Echo');
        expect(server.requests.at(-1)?.system).toContain('The project uses tabs for indentation.');
        await expect(agents(page).locator('.ingot-chat-user').last().locator('.ingot-chip')).toHaveCount(0);

        await saved.locator('.ingot-memory-undo').click();
        await expect(saved).toContainText('Memory removed');
        await expect.poll(() => fs.readdirSync(dir).filter(f => f.endsWith('.md')).length).toBe(0);

        // Manager: add, search, edit, delete; Generate memories toggle.
        await page.locator('#ingot-agents-history').click();
        await page.locator('#ingot-agents-memories').click();
        const manager = page.locator('#ingot-memories');
        await manager.locator('#ingot-memories-add').click();
        await manager.locator('#ingot-memory-text').fill('API base path is /api/v2');
        await manager.locator('#ingot-memory-save').click();
        await expect(manager.locator('.ingot-memory-row')).toContainText('API base path is /api/v2');
        await manager.locator('#ingot-memories-search').fill('nothing-like-this');
        await expect(manager.locator('.ingot-memory-row')).toHaveCount(0);
        await manager.locator('#ingot-memories-search').fill('api');
        await manager.getByRole('button', { name: 'Edit memory' }).click();
        await manager.locator('#ingot-memory-text').fill('API base path is /api/v3');
        await manager.locator('#ingot-memory-save').click();
        await expect(manager.locator('.ingot-memory-row')).toContainText('/api/v3');
        await manager.getByRole('button', { name: 'Delete memory' }).click();
        await expect(manager.locator('.ingot-memory-row')).toHaveCount(0);
        await manager.locator('#ingot-memories-generate').uncheck();
        await manager.locator('#ingot-memories-close').click();
        await send(page, 'Please remember nothing');
        await expect(agents(page).locator('.ingot-chat-agent .ingot-md').last()).toHaveText('Noted.');
        expect(server.requests.at(-1)?.system).not.toContain('REMEMBER:');
        await expect(agents(page).locator('.ingot-chat-memory')).toHaveCount(1);

        // Nearly full context (local model window is 32k tokens) offers Summarize & continue.
        await page.locator('#ingot-composer-input').fill(`big paste ${'lorem ipsum '.repeat(10_000)}`);
        await page.locator('#ingot-composer-input').press('Enter');
        await expect(page.locator('#ingot-summarize')).toBeVisible({ timeout: 30_000 });
        await page.locator('#ingot-summarize-continue').click();
        await expect(agents(page).locator('.ingot-chat-tab.active')).toContainText('(continued)');
        await expect(agents(page).locator('.ingot-chat-agent').last()).toContainText('Goal: big paste');
    });
});
