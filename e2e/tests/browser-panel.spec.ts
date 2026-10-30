import * as fs from 'fs';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { makeToolsProject, setAppearance, shot, toolBlock } from '../src/agent-tools.e2e-utils';
import { startFakeSite, type FakeSite } from '../src/fake-site';

/** IDEA-289: the Browser panel (web build: proxied frame): open external, Quote / Comment a selection, and /browser runs. */
test.describe('IDEA-289 browser panel', () => {
    test.setTimeout(180_000);
    let dir: string;
    let server: FakeOllama;
    let site: FakeSite;
    let reply: (system: string, user: string) => string;

    test.beforeEach(async () => {
        dir = makeToolsProject('ingot-browser-panel-');
        site = await startFakeSite();
        reply = () => 'Ready.';
        server = await startFakeOllama((system, user) => reply(system, user), { delayMs: 0 });
    });
    test.afterEach(async () => {
        await server.close();
        await site.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const frame = (page: Page) => page.frameLocator('#ingot-browser iframe.ingot-browser-page');
    const composer = (page: Page) => page.locator('#ingot-composer-input');
    const lastReply = (page: Page) => page.locator('#ingot-agents .ingot-chat-agent').last();
    const selectIntro = async (page: Page): Promise<void> => {
        await frame(page).locator('p').first().click({ clickCount: 3 });
        await expect(page.locator('#ingot-browser-selection')).toBeVisible();
    };

    test('opens a page from the address bar, opens it externally, quotes and comments on selected text', async ({ page }) => {
        await openIngot(page, dir);
        await dismissNotifications(page);
        await setAppearance(page, 'light');
        // Open Browser shortcut (Windows / Linux variant in Playwright's Desktop Chrome).
        await page.keyboard.press('Control+Alt+Shift+W');
        await expect(page.locator('#ingot-browser')).toBeVisible();
        await expect(page.locator('#ingot-browser-external')).toBeDisabled();

        await page.locator('#ingot-browser-address').fill(site.url);
        await page.locator('#ingot-browser-address').press('Enter');
        await expect(frame(page).locator('h1')).toHaveText('Forge Shop');
        await expect(page.locator('#ingot-browser-external')).toBeEnabled();

        const popup = page.context().waitForEvent('page');
        await page.locator('#ingot-browser-external').click();
        const external = await popup;
        await expect.poll(() => external.url()).toBe(site.url);
        await external.close();

        // Select a paragraph: the Quote / Comment bar shows under it; Quote puts page and text in the composer.
        await selectIntro(page);
        await shot(page, 'idea-289-browser-selection-light.png');
        await page.locator('#ingot-browser-quote').click();
        await expect(composer(page)).toContainText(`From Forge Shop (${site.url}): "Hand-made tools."`);
        await expect(page.locator('#ingot-browser-selection')).toHaveCount(0);

        // The shortcut quotes too, from inside the page.
        await composer(page).fill('');
        await selectIntro(page);
        await page.keyboard.press('Control+L');
        await expect(composer(page)).toContainText('"Hand-made tools."');
        await composer(page).fill('');

        // Comment: a note under the quote, sent to the chat as a message.
        await selectIntro(page);
        await page.locator('#ingot-browser-comment').click();
        await expect(page.locator('#ingot-browser-comment-input')).toBeFocused();
        await page.keyboard.type('Make this sentence bold');
        await setAppearance(page, 'dark');
        await shot(page, 'idea-289-browser-comment-dark.png');
        await page.locator('#ingot-browser-comment-input').focus();
        await page.keyboard.press('Enter');
        const sent = page.locator('#ingot-agents .ingot-chat-user').last();
        await expect(sent).toContainText(`Comment on Forge Shop (${site.url}):`);
        await expect(sent).toContainText('Hand-made tools.');
        await expect(sent).toContainText('Make this sentence bold');
        await setAppearance(page, 'light');
    });

    test('/browser turns the browser tools on for one run; the agent reads failed requests and the console', async ({ page }) => {
        let systemHadBrowser = true;
        reply = (system: string, user: string): string => {
            systemHadBrowser = system.includes('ingot/browser_open:');
            if (user.startsWith('Tool result (ingot/browser_open)')) {
                return user.includes('only for runs started with /browser') ? 'Start your message with /browser.' : toolBlock('browser_network', {});
            }
            if (user.startsWith('Tool result (ingot/browser_network)')) {
                return user.includes(`${site.url}missing-logo.png (resource)`) ? toolBlock('browser_console', { level: 'error' }) : 'No failed requests found.';
            }
            if (user.startsWith('Tool result (ingot/browser_console)')) {
                return user.includes('only the desktop app has console messages') ? 'The logo image fails to load; the console needs the desktop app.' : 'Console looked wrong.';
            }
            return toolBlock('browser_open', { url: `${site.url}broken` });
        };
        await openIngot(page, dir);
        await dismissNotifications(page);
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await setAppearance(page, 'dark');

        // Without /browser the agent has no browser tools; a call anyway is refused without a card.
        await composer(page).fill('open the broken page');
        await composer(page).press('Enter');
        await expect(lastReply(page)).toContainText('Start your message with /browser.', { timeout: 30_000 });
        expect(systemHadBrowser).toBe(false);
        await expect(page.locator('#ingot-approval-line')).toHaveCount(0);

        // /browser from the slash menu, then the task.
        await composer(page).focus();
        await page.keyboard.type('/bro');
        await expect(page.locator('#ingot-slash-builtin-browser')).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(composer(page)).toHaveText(/^\/browser\s*$/);
        await page.keyboard.type('open the broken page');
        await page.keyboard.press('Enter');
        await expect(page.locator('#ingot-approval-line')).toHaveText(`Open page: ${site.url}broken`, { timeout: 30_000 });
        expect(systemHadBrowser).toBe(true);
        await expect(page.locator('#ingot-browser')).toBeVisible();
        await page.keyboard.press('Enter');

        // Failed requests and the console are reads: they run without a card.
        await expect(lastReply(page)).toContainText('The logo image fails to load', { timeout: 30_000 });
        await expect(frame(page).locator('h1')).toHaveText('Broken page');
        await shot(page, 'idea-289-browser-run-dark.png');
        await setAppearance(page, 'light');
        await shot(page, 'idea-289-browser-run-light.png');
    });
});
