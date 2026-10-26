import * as fs from 'fs';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { makeToolsProject, setAppearance, shot, toolBlock } from '../src/agent-tools.e2e-utils';
import { startFakeSite, type FakeSite } from '../src/fake-site';

const TERMINAL_ON = '#ingot-setting-ingot-agent-terminal-enabled';
const BROWSER_ASK = '#ingot-setting-ingot-agent-browser-requireApproval';

/** IDEA-133: Settings › Tools › Agent tools drives the terminal, processes and browser tools. */
test.describe('IDEA-133 agent tools settings', () => {
    test.setTimeout(150_000);
    let dir: string;
    let server: FakeOllama;
    let site: FakeSite;
    let reply: (system: string, user: string) => string;

    test.beforeEach(async () => {
        dir = makeToolsProject('ingot-tools-settings-');
        site = await startFakeSite();
        server = await startFakeOllama((system, user) => reply(system, user), { delayMs: 0 });
    });
    test.afterEach(async () => {
        await server.close();
        await site.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const openToolsPage = async (page: Page): Promise<void> => {
        await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), page.locator('#ingot-settings'));
        await page.locator('#ingot-settings-node-agent-tools').click();
        await expect(page.locator('#ingot-settings-page-agent-tools')).toBeVisible();
    };
    const setChecked = async (page: Page, id: string, on: boolean): Promise<void> => {
        await openToolsPage(page);
        await page.locator(id).setChecked(on);
        await page.locator('#ingot-settings-ok').click();
        await expect(page.locator('#ingot-settings')).toBeHidden();
    };
    const ask = async (page: Page, text: string): Promise<void> => {
        await page.locator('#ingot-composer-input').fill(text);
        await page.locator('#ingot-composer-input').press('Enter');
    };
    const lastReply = (page: Page) => page.locator('#ingot-agents .ingot-chat-agent').last();

    test('the page groups terminal, processes and browser settings; turning them off changes what the agent can do', async ({ page }) => {
        await openIngot(page, dir);
        await dismissNotifications(page);
        await setAppearance(page, 'light');
        await openToolsPage(page);
        const body = page.locator('#ingot-settings-page-agent-tools');
        await expect(body.locator('.ingot-settings-card-title')).toHaveText(['Terminal & scripts', 'Background processes', 'Browser']);
        await expect(body.locator('.ingot-setting-label')).toHaveText([
            'Let the agent run commands', 'Ask before running commands', 'Foreground timeout (seconds)', 'Output sent to the agent (characters)',
            'Show background processes in the chat',
            'Let the agent use the browser', 'Ask before browser actions', 'Also ask before reading pages and screenshots'
        ]);
        await expect(page.locator(TERMINAL_ON)).toBeChecked();
        await expect(page.locator(BROWSER_ASK)).toBeChecked();
        await shot(page, 'idea-133-settings-light.png');
        await page.locator('#ingot-settings-ok').click();

        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');

        // Commands off: the run tools leave the agent's tool list; browser actions no longer ask.
        await setChecked(page, TERMINAL_ON, false);
        await setChecked(page, BROWSER_ASK, false);
        let systemHadRun = true;
        reply = (system: string, user: string): string => {
            systemHadRun = system.includes('ingot/run:');
            if (user.startsWith('Tool result (ingot/browser_open)')) {
                return user.includes('Forge Shop') ? 'Opened the shop without asking.' : 'Could not open.';
            }
            if (user.startsWith('Tool result (ingot/run)')) {
                return user.includes('turned off in Settings › Tools › Agent tools') ? 'Commands are turned off.' : 'It ran.';
            }
            return user.includes('run it') ? toolBlock('run', { command: 'node -v' }) : toolBlock('browser_open', { url: site.url });
        };
        await ask(page, 'open the shop');
        await expect(lastReply(page)).toContainText('Opened the shop without asking.', { timeout: 30_000 });
        await expect(page.locator('#ingot-approval-line')).toHaveCount(0);
        expect(systemHadRun).toBe(false);

        // A model that calls ingot/run anyway gets a clear refusal, without a card.
        await ask(page, 'run it');
        await expect(lastReply(page)).toContainText('Commands are turned off.', { timeout: 30_000 });
        await expect(page.locator('#ingot-approval-line')).toHaveCount(0);

        // Back on: the run tool is offered and asks again.
        await setAppearance(page, 'dark');
        await openToolsPage(page);
        await page.locator(TERMINAL_ON).setChecked(true);
        await page.locator(BROWSER_ASK).setChecked(true);
        await shot(page, 'idea-133-settings-dark.png');
        await page.locator('#ingot-settings-ok').click();
        await ask(page, 'run it');
        await expect(page.locator('#ingot-approval-line')).toHaveText('Run command: node -v', { timeout: 30_000 });
        expect(systemHadRun).toBe(true);
        await page.locator('#ingot-approval-skip').click();
        await setAppearance(page, 'light');
    });
});
