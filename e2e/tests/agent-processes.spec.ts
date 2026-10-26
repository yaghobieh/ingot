import * as fs from 'fs';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { makeToolsProject, setAppearance, shot, toolBlock } from '../src/agent-tools.e2e-utils';

/** IDEA-132: the chat's live process list (agent and user processes), with a mock model. */
test.describe('IDEA-132 background processes in the chat', () => {
    test.setTimeout(150_000);
    let dir: string;
    let server: FakeOllama;

    const reply = (user: string): string => {
        if (user.startsWith('Tool result (ingot/run)')) {
            return 'Dev server is up.';
        }
        if (user.startsWith('Tool result (ingot/processes)')) {
            return user.includes('npm run hello') && user.includes('started by user') ? 'I see your hello run.' : 'I see nothing.';
        }
        if (user.includes('list processes')) {
            return toolBlock('processes', {});
        }
        return toolBlock('run_script', { script: 'serve', background: true });
    };

    test.beforeEach(async () => {
        dir = makeToolsProject('ingot-processes-');
        server = await startFakeOllama((_system, user) => reply(user), { delayMs: 0 });
    });
    test.afterEach(async ({ page }) => {
        // Stop anything left running, then drop the throwaway project.
        await page.locator('.ingot-process-stop').evaluateAll(buttons => buttons.forEach(b => (b as HTMLButtonElement).click())).catch(() => undefined);
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const start = async (page: Page): Promise<void> => {
        await openIngot(page, dir);
        await dismissNotifications(page);
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
    };
    const ask = async (page: Page, text: string): Promise<void> => {
        await page.locator('#ingot-composer-input').fill(text);
        await page.locator('#ingot-composer-input').press('Enter');
    };

    test('an agent dev server shows command, live uptime and port; the row opens its output and Stop ends it', async ({ page }) => {
        await start(page);
        await setAppearance(page, 'light');
        await ask(page, 'start the dev server');
        await page.locator('#ingot-approval-run').click({ timeout: 30_000 });
        await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('Dev server is up.', { timeout: 30_000 });

        const row = page.locator('.ingot-process').filter({ hasText: 'npm run serve' });
        await expect(row).toHaveAttribute('data-status', 'running');
        await expect(row.locator('.ingot-process-port')).toHaveText(':4567');
        await expect(row.locator('.ingot-process-origin')).toHaveAttribute('title', 'Started by the agent');
        await expect(page.locator('#ingot-processes-count')).toHaveText('1 running');
        // Uptime ticks live.
        const first = await row.locator('.ingot-process-uptime').innerText();
        await expect.poll(() => row.locator('.ingot-process-uptime').innerText(), { timeout: 5_000 }).not.toBe(first);

        await row.locator('.ingot-process-row').click();
        await expect(row.locator('.ingot-process-output')).toContainText('Local: http://localhost:4567/');
        await expect(row.locator('.ingot-process-output')).toContainText('tick');
        await shot(page, 'idea-132-processes-light.png');

        await row.locator('.ingot-process-stop').click();
        await expect(row).toHaveAttribute('data-status', 'stopped');
        await expect(row.locator('.ingot-process-status')).toHaveText('Stopped');
        await expect(page.locator('#ingot-processes-count')).toHaveText('none running');
        await page.locator('#ingot-processes-clear').click();
        await expect(page.locator('#ingot-processes')).toHaveCount(0);
    });

    test('the user runs a script from the list; the agent sees it in ingot/processes', async ({ page }) => {
        await start(page);
        await setAppearance(page, 'dark');
        // The header button shows the (empty) list; + runs a package.json script.
        await page.locator('#ingot-agents-processes').click();
        await expect(page.locator('.ingot-processes-empty')).toBeVisible();
        await page.locator('#ingot-processes-run').click();
        const picker = page.locator('.quick-input-widget');
        await expect(picker).toContainText('Run a script (npm) or a command');
        await picker.locator('.monaco-list-row').filter({ hasText: 'hello' }).first().click();
        const row = page.locator('.ingot-process').filter({ hasText: 'npm run hello' });
        await expect(row).toHaveAttribute('data-status', 'exited', { timeout: 20_000 });
        await expect(row.locator('.ingot-process-origin')).toHaveAttribute('title', 'Started by you');
        await expect(row.locator('.ingot-process-status')).toHaveText('Done');

        await ask(page, 'list processes');
        await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('I see your hello run.', { timeout: 30_000 });

        await ask(page, 'start the dev server');
        await page.locator('#ingot-approval-run').click({ timeout: 30_000 });
        const serve = page.locator('.ingot-process').filter({ hasText: 'npm run serve' });
        await expect(serve).toHaveAttribute('data-status', 'running', { timeout: 30_000 });
        await serve.locator('.ingot-process-row').click();
        await expect(serve.locator('.ingot-process-output')).toContainText('tick');
        await shot(page, 'idea-132-processes-dark.png');
        await serve.locator('.ingot-process-stop').click();
        await expect(serve).toHaveAttribute('data-status', 'stopped');
        await page.locator('#ingot-agents-processes').click();
        await setAppearance(page, 'light');
    });
});
