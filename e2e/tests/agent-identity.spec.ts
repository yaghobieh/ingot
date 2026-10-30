import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { setAppearance, shot, tokenColor } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/** Wherever the agent shows who it is (stripe button, panel tab, empty state, reply head) it is the blue Rex </> glyph, never the orange ingot. */
const stopColor = (page: Page, scope: string): Promise<string> =>
    page.locator(`${scope} .ingot-rex-stop-mid`).first().evaluate(el => getComputedStyle(el).stopColor);

test.describe('agent identity', () => {
    let server: FakeOllama;

    test.beforeEach(async () => {
        server = await startFakeOllama(() => 'Hello from the agent.');
    });

    test.afterEach(async () => {
        await server.close();
    });

    for (const scheme of ['dark', 'light'] as const) {
        test(`the agent is the Rex glyph everywhere (${scheme})`, async ({ page }) => {
            test.setTimeout(120_000);
            await openIngot(page);
            await dismissNotifications(page);
            await setAppearance(page, scheme);
            const rexBlue = await tokenColor(page, '--ingot-rex-mid');

            const stripe = page.locator('#ingot-rs-agents');
            await expect(stripe.locator('svg.ingot-rex-mark')).toBeVisible();
            await expect(stripe.locator('.codicon')).toHaveCount(0);
            expect(await stopColor(page, '#ingot-rs-agents')).toBe(rexBlue);

            await connectOllama(page, server);
            await page.locator('#ingot-agents-new').click();
            await expect(page.locator('#ingot-agents-empty-state svg.ingot-rex-mark')).toBeVisible();
            await pickModel(page, 'ollama-local');
            await page.locator('#ingot-composer-input').fill('Say hello');
            await page.locator('#ingot-composer-input').press('Enter');
            const head = page.locator('.ingot-chat-agent-head').first();
            await expect(head).toContainText('Ingot Agent');
            await expect(head.locator('svg.ingot-rex-mark')).toBeVisible();
            expect(await stopColor(page, '.ingot-chat-agent-head')).toBe(rexBlue);
            // No orange ingot, avatar tile or codicon stands in for the agent anywhere in the panel.
            await expect(page.locator('#ingot-agents .ingot-brand-mark, #ingot-agents .ingot-app-icon, .ingot-chat-agent-head .codicon')).toHaveCount(0);
            expect(await head.locator('svg.ingot-rex-mark').evaluate(el => getComputedStyle(el).backgroundColor)).toBe('rgba(0, 0, 0, 0)');

            // The panel's tab icon is the Rex mask in Rex blue (side and main-area tab bars alike).
            const tabIcon = page.locator("[id^='shell-tab-ingot-agents'] .lm-TabBar-tabIcon");
            if (await tabIcon.count()) {
                await expect(tabIcon.first()).toHaveClass(/ingot-icon-rex/);
                expect(await tabIcon.first().evaluate(el => getComputedStyle(el).backgroundColor)).toBe(rexBlue);
            }
            await shot(page, `agent-identity-${scheme}.png`);
        });
    }
});
