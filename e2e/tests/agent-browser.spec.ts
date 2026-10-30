import * as fs from 'fs';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { makeToolsProject, setAppearance, shot, toolBlock } from '../src/agent-tools.e2e-utils';
import { startFakeSite, type FakeSite } from '../src/fake-site';

/** IDEA-130: the agent drives Ingot's browser panel (web build: proxied frame), with a mock model and a local site. */
test.describe('IDEA-130 agent browser tool', () => {
    test.setTimeout(150_000);
    let dir: string;
    let server: FakeOllama;
    let site: FakeSite;
    let reply: (user: string) => string;

    test.beforeEach(async () => {
        dir = makeToolsProject('ingot-browser-');
        site = await startFakeSite();
        server = await startFakeOllama((_system, user) => reply(user), { delayMs: 0 });
    });
    test.afterEach(async () => {
        await server.close();
        await site.close();
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
    const lastReply = (page: Page) => page.locator('#ingot-agents .ingot-chat-agent').last();
    const frame = (page: Page) => page.frameLocator('#ingot-browser iframe.ingot-browser-page');

    test('opens a page, types into a search form and reads the result, each action on the approval card', async ({ page }) => {
        reply = (user: string): string => {
            if (user.startsWith('Tool result (ingot/browser_open)')) {
                return !user.includes('/ingot-browser/proxy') && user.includes(`Forge Shop — ${site.url}`) && user.includes('[1] a "Cart"') && user.includes('"Search"') ? toolBlock('browser_type', { label: 'Search', text: 'red shoes', submit: true }) : 'Page looked wrong.';
            }
            if (user.startsWith('Tool result (ingot/browser_type)')) {
                return user.includes('/search?q=red+shoes') ? toolBlock('browser_read', {}) : 'Search did not submit.';
            }
            if (user.startsWith('Tool result (ingot/browser_read)')) {
                return user.includes('Results for red shoes') ? 'Found red shoes for 49 €.' : 'No results.';
            }
            return toolBlock('browser_open', { url: site.url });
        };
        await start(page);
        await setAppearance(page, 'light');
        await ask(page, '/browser find red shoes in the shop');
        await expect(page.locator('#ingot-approval-line')).toHaveText(`Open page: ${site.url}`, { timeout: 30_000 });
        await page.keyboard.press('Enter');

        await expect(page.locator('#ingot-approval-line')).toHaveText('Type: "red shoes" into "Search" and submit', { timeout: 30_000 });
        // The panel shows the page while the agent drives it.
        await expect(frame(page).locator('h1')).toHaveText('Forge Shop');
        await expect(page.locator('#ingot-browser-banner')).toContainText('The agent is using the browser.');
        await expect(page.locator('#ingot-browser-overlay')).toBeVisible();
        await shot(page, 'idea-130-browser-agent-light.png');
        await page.locator('#ingot-approval-always').click();

        // browser_read runs at once (reads do not ask by default).
        await expect(lastReply(page)).toContainText('Found red shoes for 49 €.', { timeout: 30_000 });
        await expect(frame(page).locator('h1')).toHaveText('Results for red shoes');
        await expect(page.locator('#ingot-browser-address')).toHaveValue(`${site.url}search?q=red+shoes`);
        // The run ended: no overlay any more.
        await expect(page.locator('#ingot-browser-overlay')).toHaveCount(0);
    });

    test('Take control: the agent waits, the user browses, Give back control resumes the agent where the user left off', async ({ page }) => {
        reply = (user: string): string => {
            if (user.startsWith('Tool result (ingot/browser_open)')) {
                return 'Opened.';
            }
            if (user.startsWith('Tool result (ingot/browser_read)')) {
                return user.includes('The user had control and is now on') && user.includes('Your cart') ? 'You are on the cart: 2 items.' : 'I could not tell.';
            }
            return user.includes('what is on the page') ? toolBlock('browser_read', {}) : toolBlock('browser_open', { url: site.url });
        };
        await start(page);
        await setAppearance(page, 'dark');
        await ask(page, '/browser open the shop');
        await page.locator('#ingot-approval-run').click({ timeout: 30_000 });
        await expect(lastReply(page)).toContainText('Opened.', { timeout: 30_000 });

        await page.locator('#ingot-browser-control').click();
        await expect(page.locator('#ingot-browser-control')).toHaveText('Give back control');
        await expect(page.locator('#ingot-browser-banner')).toContainText('You have control of the browser.');

        await ask(page, '/browser what is on the page');
        await expect(page.locator('#ingot-browser-banner')).toContainText('The agent is waiting for you.', { timeout: 30_000 });
        // The user drives the page: links load through the panel.
        await frame(page).getByRole('link', { name: 'Cart' }).click();
        await expect(frame(page).locator('h1')).toHaveText('Your cart');
        await shot(page, 'idea-130-browser-user-dark.png');

        await page.locator('#ingot-browser-control').click();
        await expect(page.locator('#ingot-browser-control')).toHaveText('Take control');
        await expect(lastReply(page)).toContainText('You are on the cart: 2 items.', { timeout: 30_000 });
        await setAppearance(page, 'light');
    });
});
