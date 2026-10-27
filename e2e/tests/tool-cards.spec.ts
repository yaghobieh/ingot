import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot, runCommand } from '../src/app.utils';
import { FIXTURES_DIR } from '../src/e2e.consts';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { makeToolsProject } from '../src/agent-tools.e2e-utils';

/** IDEA-177: tool steps in the agent chat are rich cards (terminal block, profile card), with Explored and Thought rows. */
const SHOTS = process.env.INGOT_SCREENSHOT_DIR;
const COMMAND = 'echo "== status ==" && git --version | head -1 && node -e "console.log(41 + 1)"';

const setScheme = async (page: Page, scheme: 'light' | 'dark'): Promise<void> => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.locator('#ingot-rs-theme').click();
    await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'System' }).first().click();
    await expect(page.locator('body')).toHaveClass(new RegExp(`ingot-${scheme}`));
};

for (const scheme of ['light', 'dark'] as const) {
    test.describe(`IDEA-177 rich tool cards (${scheme})`, () => {
        test.setTimeout(150_000);
        let dir: string;
        let server: FakeOllama;

        test.beforeEach(async () => {
            dir = makeToolsProject('ingot-tool-cards-');
            fs.mkdirSync(path.join(dir, '.ingot'), { recursive: true });
            fs.writeFileSync(path.join(dir, '.ingot', 'mcp.json'), JSON.stringify({
                mcpServers: { github: { command: 'node', args: [path.join(FIXTURES_DIR, 'mcp', 'profile-server.mjs')] } }
            }));
            fs.writeFileSync(path.join(dir, 'notes.md'), '# Notes\n');
            server = await startFakeOllama((_system, user) => {
                if (user.startsWith('Tool result (ingot/run)')) {
                    return '<think>The command ran; now look up who is signed in.</think>\n<<<TOOL github/get_me\n{}\n>>>END';
                }
                if (user.startsWith('Tool result (github/get_me)')) {
                    return 'You are **Ingot Dev** and the toolchain works.';
                }
                return `<think>Check the toolchain first.</think>\nChecking.\n\n<<<TOOL ingot/run\n${JSON.stringify({ command: COMMAND, description: 'Check the toolchain' })}\n>>>END`;
            }, { delayMs: 0 });
        });
        test.afterEach(async () => {
            await server.close();
            fs.rmSync(dir, { recursive: true, force: true });
        });

        test('terminal block, profile card, Explored and Thought rows', async ({ page }) => {
            await openIngot(page, dir);
            await dismissNotifications(page);
            await setScheme(page, scheme);
            // Enable the project MCP server (servers stay off until enabled).
            await runCommand(page, 'Rules, Commands & MCP Servers');
            const mcp = page.locator('.ingot-mcp');
            await mcp.locator('#ingot-mcp-tab-mcps').click();
            const row = mcp.locator('#ingot-mcp-row-github');
            await row.locator('.ingot-mcp-toggle').check({ force: true });
            await expect(row.locator('.ingot-mcp-summary')).toHaveText(/1 tool enabled/, { timeout: 15_000 });

            await connectOllama(page, server);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            await page.locator('#ingot-composer-input').fill('check the toolchain and who I am');
            await page.locator('#ingot-composer-input').press('Enter');
            await expect(page.locator('#ingot-approval-line')).toContainText('Run command', { timeout: 30_000 });
            await page.locator('#ingot-approval-run').click();
            await expect(page.locator('#ingot-approval-line')).toContainText('get_me', { timeout: 30_000 });
            await page.locator('#ingot-approval-run').click();
            await expect(page.locator('#ingot-agents .ingot-chat-agent .ingot-md').last()).toContainText('the toolchain works', { timeout: 30_000 });

            const term = page.locator('#ingot-agents .ingot-tc-terminal').first();
            await expect(term.locator('.ingot-tc-title')).toHaveText('Check the toolchain');
            await expect(term.locator('.ingot-tc-programs')).toHaveText('echo, git, head, node');
            await expect(term.locator('.ingot-tc-status.ok')).toContainText('exit 0');
            // Collapsed when done; the header expands it to the highlighted command and output.
            await expect(term.locator('.ingot-tc-body')).toHaveCount(0);
            await term.locator('.ingot-tc-head').click();
            await expect(term.locator('.ingot-tc-command .ingot-sh-cmd').first()).toHaveText('echo');
            await expect(term.locator('.ingot-tc-command .ingot-sh-str').first()).toHaveText('"== status =="');
            await expect(term.locator('.ingot-tc-output')).toContainText('42');

            const card = page.locator('#ingot-agents #ingot-pc-ingot-dev');
            await expect(card.locator('.ingot-pc-name')).toHaveText('Ingot Dev');
            await expect(card.locator('.ingot-pc-login')).toHaveText('@ingot-dev');
            await expect(card.locator('.ingot-pc-facts')).toContainText('Tel Aviv, Israel');
            await expect(card.locator('.ingot-pc-facts')).toContainText('https://ingot-portal.vercel.app');
            await expect(card.locator('.ingot-pc-facts')).toContainText('dev@ingot.dev');
            await expect(card.locator('.ingot-pc-stats')).toContainText('45');
            await expect(card.locator('.ingot-pc-stats')).toContainText('Followers');
            await expect(page.locator('#ingot-agents .ingot-tc-profile .ingot-tc-line')).toContainText('Ran get_me in github');

            await expect(page.locator('#ingot-agents .ingot-chat-thought').first()).toContainText('Thought');
            await page.locator('#ingot-agents .ingot-chat-thought-row').first().click();
            await expect(page.locator('#ingot-agents .ingot-chat-thought-text').first()).toHaveText('Check the toolchain first.');
            // The raw tool rows are replaced by the cards (no "Run ingot/run" step lines).
            await expect(page.locator('#ingot-agents .ingot-chat-step', { hasText: 'ingot/run' })).toHaveCount(0);
            // Brand tokens: the profile stats icons are gold; the command name is the scheme's blue.
            await expect(card.locator('.ingot-pc-stat .codicon').first()).toHaveCSS('color', 'rgb(217, 160, 78)');
            await expect(term.locator('.ingot-sh-cmd').first()).toHaveCSS('color', scheme === 'light' ? 'rgb(59, 111, 217)' : 'rgb(127, 163, 240)');
            if (SHOTS) {
                fs.mkdirSync(SHOTS, { recursive: true });
                await page.locator('#ingot-agents').screenshot({ path: path.join(SHOTS, `tool-cards-${scheme}.png`) });
                await term.screenshot({ path: path.join(SHOTS, `tool-cards-terminal-${scheme}.png`) });
                await page.locator('#ingot-agents .ingot-tc-profile').screenshot({ path: path.join(SHOTS, `tool-cards-profile-${scheme}.png`) });
            }
        });
    });
}
