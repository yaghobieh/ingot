import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot, runCommand } from '../src/app.utils';
import { CONFIG_PROJECT, E2E_CONFIG_DIR, E2E_KEYSTORE_FILE, FAKE_SLACK_MCP_URL, FAKE_SLACK_PORT } from '../src/e2e.consts';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { startFakeSlack, type FakeSlack } from '../src/fake-slack-mcp';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';

const TOKEN = 'xoxp-e2e-fake';
const GLOBAL_MCP = path.join(E2E_CONFIG_DIR, 'mcp.json');
const SETTINGS = path.join(E2E_CONFIG_DIR, 'settings.json');
const SECRET_KEY = 'mcp:slack:header:Authorization';
const card = (page: Page) => page.locator('#ingot-slack-card');
const composer = (page: Page) => page.locator('#ingot-composer-input');

const openMcpPage = async (page: Page): Promise<void> => {
    await actUntilVisible(() => runCommand(page, 'Rules, Commands & MCP Servers'), card(page));
};

/** Leaves no Slack server or "Always Run" choice behind for other specs, even when this one fails midway. */
const cleanUp = (): void => {
    if (fs.existsSync(GLOBAL_MCP)) {
        const json = JSON.parse(fs.readFileSync(GLOBAL_MCP, 'utf8')) as { mcpServers?: Record<string, unknown> };
        delete json.mcpServers?.slack;
        fs.writeFileSync(GLOBAL_MCP, `${JSON.stringify(json, undefined, 2)}\n`);
    }
    if (fs.existsSync(SETTINGS)) {
        const settings = JSON.parse(fs.readFileSync(SETTINGS, 'utf8')) as Record<string, unknown>;
        delete settings['ingot.agent.approvals.alwaysRun'];
        fs.writeFileSync(SETTINGS, JSON.stringify(settings, undefined, 4));
    }
};

test.describe('IDEA-270 Slack as a built-in MCP connection', () => {
    let slack: FakeSlack;
    let model: FakeOllama;

    test.beforeAll(async () => {
        cleanUp();
        slack = await startFakeSlack(FAKE_SLACK_PORT, TOKEN);
        model = await startFakeOllama((_system, user) => {
            if (user.startsWith('Tool result (slack/slack_send_message)')) {
                return 'Posted to #deploys.';
            }
            if (user.startsWith('Tool result (slack/slack_search_public)')) {
                return 'Found the thread.\n<<<TOOL slack/slack_send_message\n{"channel_id": "C123", "message": "Deploy is done"}\n>>>END';
            }
            return 'Searching Slack.\n<<<TOOL slack/slack_search_public\n{"query": "deploy"}\n>>>END';
        });
    });

    test.afterAll(async () => {
        cleanUp();
        await slack.close();
        await model.close();
    });

    test('connects with a token, gives the agent Slack tools, always asks before posting, then disconnects', async ({ page }) => {
        await openIngot(page, CONFIG_PROJECT);
        await dismissNotifications(page);
        await setAppearance(page, 'light');
        await openMcpPage(page);
        await expect(card(page)).toHaveAttribute('data-state', 'disconnected');
        await expect(page.locator('#ingot-slack-status')).toHaveText('Not connected');
        await shot(page, 'slack-1-disconnected-light.png');

        // One-time token: validated, stored in the keychain, never in mcp.json.
        await page.locator('#ingot-slack-connect').click();
        await page.locator('#ingot-slack-token').fill('ghp_not-a-slack-token');
        await page.locator('#ingot-slack-save').click();
        await expect(page.locator('#ingot-slack-error')).toContainText('xoxp-');
        await page.locator('#ingot-slack-token').fill(TOKEN);
        await shot(page, 'slack-2-token-light.png');
        await page.locator('#ingot-slack-save').click();
        await expect(card(page)).toHaveAttribute('data-state', 'connected', { timeout: 20_000 });
        await expect(page.locator('#ingot-slack-status')).toHaveText('Connected · 5 tools');
        await expect(page.locator('#ingot-slack-disconnect')).toBeVisible();
        const json = fs.readFileSync(GLOBAL_MCP, 'utf8');
        expect(json).toContain(FAKE_SLACK_MCP_URL);
        expect(json).toContain('"Authorization": "${keychain}"');
        expect(json).not.toContain(TOKEN);
        expect(fs.readFileSync(E2E_KEYSTORE_FILE, 'utf8')).toContain(SECRET_KEY);
        await shot(page, 'slack-3-connected-light.png');

        // The agent sees the Slack tools. A read waits on the normal MCP card; "Always Run" skips reads from then on…
        await connectOllama(page, model);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await composer(page).fill('Find the deploy thread in Slack and tell the team it is done.');
        await composer(page).press('Enter');
        await expect(page.locator('#ingot-approval-line')).toContainText('slack: slack_search_public', { timeout: 30_000 });
        await page.locator('#ingot-approval-always').click();

        // …but posting always shows the card first, without "Always Run".
        await expect(page.locator('#ingot-approval-line')).toContainText('Post to Slack (slack_send_message): C123: Deploy is done', { timeout: 30_000 });
        await expect(page.locator('#ingot-approval-always')).toHaveCount(0);
        expect(slack.calls.map(c => c.tool)).toEqual(['slack_search_public']);
        await shot(page, 'slack-4-post-approval-light.png');
        await page.locator('#ingot-approval-run').click();
        await expect(page.locator('#ingot-agents .ingot-chat-agent .ingot-md').last()).toHaveText('Posted to #deploys.', { timeout: 30_000 });
        expect(slack.calls).toEqual([
            { tool: 'slack_search_public', args: { query: 'deploy' } },
            { tool: 'slack_send_message', args: { channel_id: 'C123', message: 'Deploy is done' } }
        ]);
        expect(model.requests.find(r => r.user.includes('deploy thread'))?.system).toContain('slack/slack_send_message');

        await setAppearance(page, 'dark');
        await openMcpPage(page);
        await expect(card(page)).toHaveAttribute('data-state', 'connected');
        await shot(page, 'slack-5-connected-dark.png');
        await setAppearance(page, 'light');

        // Disconnect removes the server and its keychain token.
        await openMcpPage(page);
        await page.locator('#ingot-slack-disconnect').click();
        await expect(card(page)).toHaveAttribute('data-state', 'disconnected');
        await expect(page.locator('#ingot-slack-connect')).toBeVisible();
        expect(fs.readFileSync(GLOBAL_MCP, 'utf8')).not.toContain(FAKE_SLACK_MCP_URL);
        expect(fs.readFileSync(E2E_KEYSTORE_FILE, 'utf8')).not.toContain(SECRET_KEY);
    });
});
