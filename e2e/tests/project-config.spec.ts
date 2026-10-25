import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot, runCommand } from '../src/app.utils';
import { CONFIG_PROJECT } from '../src/e2e.consts';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';

const composer = (page: Page) => page.locator('#ingot-composer-input');
const config = (page: Page) => page.locator('.ingot-mcp');

const newOllamaAgent = async (page: Page): Promise<void> => {
    await page.locator('#ingot-agents-new').click();
    await pickModel(page, 'ollama-local');
};

test.describe('IDEA-30/31 project rules, slash commands and MCP servers', () => {
    let server: FakeOllama;

    test.beforeEach(async () => {
        server = await startFakeOllama((_system, user) => {
            if (user.startsWith('Tool result (calc/add)')) {
                return `The sum is ${user.split('\n').pop()}.`;
            }
            if (user.includes('calculator')) {
                return 'Let me use the calculator.\n<<<TOOL calc/add\n{"a": 2, "b": 3}\n>>>END';
            }
            return 'It sums the values.';
        });
    });
    test.afterEach(async () => { await server.close(); });

    test('applies .ingot rules, existing rule folders and AGENTS.md, and expands / commands from the menu', async ({ page }) => {
        await openIngot(page, CONFIG_PROJECT);
        await connectOllama(page, server);
        await page.locator('#files').getByText('src', { exact: true }).click();
        await page.locator('#files').getByText('index.ts', { exact: true }).dblclick();
        await newOllamaAgent(page);

        await dismissNotifications(page);
        await composer(page).focus();
        await page.keyboard.type('/');
        const menu = page.locator('#ingot-slash-menu');
        await expect(menu).toBeVisible();
        await expect(menu).toContainText('/explain');
        await expect(menu).toContainText('/review');
        await expect(menu).toContainText('/release-notes');
        await page.keyboard.type('ex');
        await expect(menu.locator('.ingot-slash-item')).toHaveCount(1);
        await page.keyboard.press('Enter');
        await expect(composer(page)).toHaveValue('/explain ');
        await page.keyboard.type('the total function');
        await page.keyboard.press('Enter');

        await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toHaveText('It sums the values.');
        await expect(page.locator('#ingot-agents .ingot-chat-user').last()).toContainText('/explain the total function');
        // Applied rules show as chips on the message (IDEA-77).
        await expect(page.locator('#ingot-agents .ingot-chat-user').last().locator('.ingot-chip-rule').first()).toBeVisible();
        const request = server.requests.at(-1)!;
        expect(request.user).toContain('Explain the total function in two sentences. EXPLAIN-MARKER');
        expect(request.system).toContain('AGENTS-MARKER');
        expect(request.system).toContain('INGOT-RULE-MARKER');
        // Glob rule (**/*.ts) applies because index.ts is the active file.
        expect(request.system).toContain('CURSOR-TS-MARKER');
    });

    test('MCP servers stay off until enabled, then list tools and the agent calls them', async ({ page }) => {
        await openIngot(page, CONFIG_PROJECT);
        await dismissNotifications(page);
        await runCommand(page, 'Rules, Commands & MCP Servers');
        await expect(config(page)).toBeVisible();
        await config(page).locator('#ingot-mcp-tab-rules').click();
        const rules = config(page).locator('#ingot-mcp-items-rule');
        await expect(rules).toContainText('AGENTS.md');
        await expect(rules).toContainText('always');
        await expect(rules).toContainText('**/*.ts');
        await config(page).locator('#ingot-mcp-tab-skills').click();
        await expect(config(page).locator('#ingot-mcp-items-skill')).toContainText('release-notes');
        await config(page).locator('#ingot-mcp-tab-mcps').click();
        const calc = config(page).locator('#ingot-mcp-row-calc');
        await expect(calc.locator('.ingot-mcp-summary')).toHaveText('Disabled');

        await calc.locator('.ingot-mcp-toggle').check({ force: true });
        await expect(calc.locator('.ingot-mcp-summary')).toHaveText(/2 tools enabled/, { timeout: 15_000 });
        await calc.locator('.ingot-mcp-row-main').click();
        await expect(calc.locator('.ingot-mcp-tools')).toContainText('add');
        await expect(calc.locator('.ingot-mcp-tools')).toContainText('mode');
        await expect(calc).toContainText('CALC_MODE');

        await connectOllama(page, server);
        await newOllamaAgent(page);
        await composer(page).fill('What is 2 + 3? Use the calculator.');
        await composer(page).press('Enter');
        await expect(page.locator('#ingot-agents .ingot-chat-tool')).toContainText('5');
        await expect(page.locator('#ingot-agents .ingot-chat-tool')).toContainText('calc/add');
        await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toHaveText('The sum is 5.');
        expect(server.requests.find(r => r.user.includes('calculator'))?.system).toContain('calc/add');

        await page.locator('#ingot-rs-mcp').click();
        await config(page).locator('#ingot-mcp-row-calc .ingot-mcp-toggle').uncheck({ force: true }).catch(() => undefined);
    });
});
