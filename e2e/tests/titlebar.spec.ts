import * as path from 'path';
import { expect, test } from '@playwright/test';
import { dismissNotifications, openIngot, signOutIfSignedIn } from '../src/app.utils';
import { signInToIngot, startProPlusServer } from '../src/account.e2e-utils';
import type { FakeIngotServer } from '../src/fake-ingot-server';
import { SHELL_SELECTOR } from '../src/e2e.consts';

/** IDEA-118: title bar right — bottom panel and chat icons, the Zaprex T-rex (IDEA-179, heavy runs only), then the Agents Window pill. */
test.describe('IDEA-118 title bar window actions', () => {
    let account: FakeIngotServer;
    test.beforeEach(async () => {
        account = await startProPlusServer();
    });
    test.afterEach(async ({ page }) => {
        await signOutIfSignedIn(page).catch(() => undefined);
        await account.close();
    });

    test('icons sit left of the Agents Window pill and toggle their panels', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        await signInToIngot(page);
        // The T-rex ("Hand off to Rex") shows on PRO+ only during a heavy run (zaprex-plan.spec), so not here.
        await expect(page.locator('#ingot-tb-zaprex')).toHaveCount(0);
        const ids = ['#ingot-tb-panel', '#ingot-tb-chat', '#ingot-tb-agents-window'];
        const boxes = [];
        for (const id of ids) {
            await expect(page.locator(id)).toBeVisible();
            boxes.push((await page.locator(id).boundingBox())!);
        }
        for (let i = 1; i < boxes.length; i++) {
            expect(boxes[i].x).toBeGreaterThan(boxes[i - 1].x);
        }
        await expect(page.locator('#ingot-tb-agents-window')).toHaveText(/Agents Window/);

        // Bottom panel toggle.
        const panel = page.locator('#ingot-tb-panel');
        const wasOpen = (await panel.getAttribute('aria-pressed')) === 'true';
        await panel.click();
        await expect(panel).toHaveAttribute('aria-pressed', String(!wasOpen));
        await expect(page.locator('#theia-bottom-content-panel')).toBeVisible({ visible: !wasOpen });
        await panel.click();
        await expect(panel).toHaveAttribute('aria-pressed', String(wasOpen));

        // Chat toggle.
        const chat = page.locator('#ingot-tb-chat');
        const chatOpen = await page.locator('#ingot-agents').isVisible();
        await chat.click();
        await expect(page.locator('#ingot-agents')).toBeVisible({ visible: !chatOpen });
        await expect(chat).toHaveAttribute('aria-pressed', String(!chatOpen));
        await chat.click();
        await expect(page.locator('#ingot-agents')).toBeVisible({ visible: chatOpen });

        // IDEA-179: one gear only (bottom of the left stripe); the title bar has no second gear.
        await expect(page.locator('#ingot-tb-settings')).toHaveCount(0);
        await expect(page.locator('.ingot-tb .codicon-settings-gear')).toHaveCount(0);
        await expect(page.locator('#ingot-stripe-settings')).toBeVisible();
    });

    test('Agents Window opens a window with only the chat, and leaves the main layout alone', async ({ page, context }) => {
        await openIngot(page);
        await dismissNotifications(page);
        // The Agents Window pill is a Pro feature (IDEA-271).
        await signInToIngot(page);
        const popup = context.waitForEvent('page');
        await page.locator('#ingot-tb-agents-window').click();
        const agents = await popup;
        expect(agents.url()).toContain('ingotWindow=agents');
        await expect(agents.locator(SHELL_SELECTOR)).toBeVisible({ timeout: 60_000 });
        await expect(agents.locator('body')).toHaveClass(/ingot-agents-window/);
        await expect(agents.locator('#theia-main-content-panel #ingot-agents')).toBeVisible({ timeout: 30_000 });
        await expect(agents.locator('#theia-left-content-panel')).toBeHidden();
        await expect(agents.locator('#ingot-tb-agents-window')).toBeHidden();
        await expect(agents).toHaveTitle(/Agents/);
        await agents.close();

        // The main window keeps the project tree and the chat in its side panel.
        await openIngot(page);
        await expect(page.locator('#theia-left-content-panel')).toBeVisible();
        await expect(page.locator('#theia-main-content-panel #ingot-agents')).toHaveCount(0);
    });

    // Dark mode must use the dark Ingot tokens: muted icons are light gray on dark, not the light theme's dark gray.
    for (const [scheme, muted, panel] of [['dark', 'rgb(154, 160, 171)', 'rgb(42, 45, 54)'], ['light', 'rgb(94, 102, 115)', 'rgb(238, 240, 244)']] as const) {
        test(`title bar icons, Shift Shift chip and Agents pill use the ${scheme} tokens`, async ({ page }) => {
            await openIngot(page);
            await dismissNotifications(page);
            await signInToIngot(page);
            await page.locator('#ingot-rs-theme').click();
            await page.locator('.quick-input-widget .monaco-list-row', { hasText: scheme === 'dark' ? 'Dark' : 'Light' }).first().click();
            await expect(page.locator('body')).toHaveClass(new RegExp(`ingot-${scheme}`));
            await expect(page.locator('#ingot-tb-panel:not(.pressed), #ingot-tb-chat:not(.pressed)').first()).toHaveCSS('color', muted);
            await expect(page.locator('.ingot-tb-search-kbd')).toHaveCSS('background-color', panel);
            await expect(page.locator('#ingot-tb-agents-window')).toHaveCSS('background-color', panel);
            if (process.env.SHOTS_DIR) {
                await page.locator('#ingot-tb-chat').hover();
                await page.locator('.ingot-tb').screenshot({ path: path.join(process.env.SHOTS_DIR, `titlebar-${scheme}.png`) });
            }
        });
    }
});
