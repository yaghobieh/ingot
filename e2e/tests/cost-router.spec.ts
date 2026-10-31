import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot, runCommand, signOutIfSignedIn } from '../src/app.utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeIngotServer, type FakeIngotServer } from '../src/fake-ingot-server';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import {
    AUTOPILOT_PAGE, HABITS_PAGE, currentAppearance, disableHabits, enableHabits, openSettingsPage, resetAutopilotSettings, setSettings
} from '../src/autopilot.e2e-utils';

/**
 * IDEA-307 Cost Forecast + Autopilot Model Router: the composer estimates the next run (tokens × model price) and asks
 * before a run over the warning; with the router on, a simple step goes to a cheaper gateway model with a silver
 * "Routed to cheaper model" note and "Use original". The model kept per task type is saved to Habits.
 */
const composer = (page: Page) => page.locator('#ingot-composer-input');
const agents = (page: Page) => page.locator('#ingot-agents');
const lastReply = (page: Page) => agents(page).locator('.ingot-chat-agent .ingot-md').last();
const forecast = (page: Page) => page.locator('#ingot-cost-forecast');

const send = async (page: Page, text: string): Promise<void> => {
    await composer(page).fill(text);
    await composer(page).press('Enter');
    await expect(lastReply(page)).toContainText(`Echo: ${text}`, { timeout: 60_000 });
};

const setByok = async (page: Page, on: boolean): Promise<void> => {
    await runCommand(page, 'Ingot: Models');
    const byok = page.locator('#ingot-models-byok');
    if (await byok.isChecked() !== on) {
        await byok.click();
    }
    await expect(byok).toBeChecked({ checked: on });
};

test.describe('IDEA-307 Cost Forecast + Autopilot Model Router', () => {
    test.setTimeout(300_000);
    let dir: string;
    let server: FakeIngotServer;

    test.beforeEach(async () => {
        resetAutopilotSettings();
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-cost-router-')));
        fs.writeFileSync(path.join(dir, 'cart.ts'), 'export const total = (cents: number[]): number => cents.reduce((a, b) => a + b, 0);\n');
        server = await startFakeIngotServer();
    });

    test.afterEach(async ({ page }) => {
        await signOutIfSignedIn(page);
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
        resetAutopilotSettings();
    });

    test('estimate in the composer, simple steps routed to a cheaper model, Use original, Habits and the cost warning', async ({ page }) => {
        await openIngot(page, dir);
        await dismissNotifications(page);
        const appearance = await currentAppearance(page);
        try {
            await enableHabits(page, '2');
            await setAppearance(page, 'dark');
            // Only the gateway's models: BYOK providers stay out of this run.
            await setByok(page, false);
            const popup = page.waitForEvent('popup');
            await runCommand(page, 'Account: Sign in to Ingot…');
            (await popup).close();
            await expect(page.locator('#status-bar-ingot-account-status')).toContainText('1M left');
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ingot:ingot-mock');
            await dismissNotifications(page);

            // The estimate follows the draft and the model it would run on.
            await expect(forecast(page)).toHaveCount(0);
            await composer(page).fill('rename total to sum');
            await expect(forecast(page)).toHaveText(/^~\$/);
            await expect(forecast(page)).toHaveAttribute('data-model', 'ingot:ingot-mock');
            await expect(forecast(page)).not.toHaveClass(/routed/);
            const fullUsd = Number(await forecast(page).getAttribute('data-usd'));
            expect(fullUsd).toBeGreaterThan(0);
            await expect(forecast(page)).toHaveAttribute('title', /Estimated cost of the next run: .* on Ingot Mock/);

            // Router on (composer More menu): the same draft is priced on the cheaper model.
            await page.locator('#ingot-composer-more').click();
            await expect(page.locator('#ingot-composer-router')).toHaveText('Router off');
            await page.locator('#ingot-composer-router').click();
            await expect(page.locator('#ingot-composer-router')).toHaveText('Router on');
            await page.locator('#ingot-composer-more').click();
            await expect(forecast(page)).toHaveClass(/routed/);
            await expect(forecast(page)).toHaveAttribute('data-model', 'ingot:ingot-fast');
            expect(Number(await forecast(page).getAttribute('data-usd'))).toBeLessThan(fullUsd);
            await shot(page, 'IDEA-307-forecast-routed-dark.png');

            await composer(page).press('Enter');
            await expect(lastReply(page)).toContainText('Echo: rename total to sum', { timeout: 60_000 });
            expect(server.calls.at(-1)?.model).toBe('ingot-fast');
            const route = agents(page).locator('.ingot-habit-note-route').last();
            await expect(route).toContainText('Routed to cheaper model');
            await expect(route).toContainText('Ingot Fast instead of Ingot Mock');
            await shot(page, 'IDEA-307-routed-note-dark.png');

            // "Use original" runs the turn again on the chosen model and counts the routed model as turned down.
            await route.locator('.ingot-habit-note-action').click();
            await expect(route).toContainText('ran again on Ingot Mock');
            await expect.poll(() => server.calls.at(-1)?.model).toBe('ingot-mock');
            await expect(lastReply(page)).toContainText('Echo: rename total to sum', { timeout: 60_000 });

            // Kept twice, turned down once: the model is saved to Habits for rename tasks.
            await expect(agents(page).locator('.ingot-habit-note-habit')).toHaveCount(0);
            await send(page, 'rename tax to vat');
            expect(server.calls.at(-1)?.model).toBe('ingot-fast');
            const saved = agents(page).locator('.ingot-habit-note-habit').last();
            await expect(saved).toContainText('Saved to Habits');
            await expect(saved).toContainText(/Ingot Fast for rename tasks/i);
            await send(page, 'rename coupon to voucher');
            await expect(agents(page).locator('.ingot-habit-note-route').last()).toContainText('from Habits');
            await setAppearance(page, 'light');
            await shot(page, 'IDEA-307-saved-to-habits-light.png');

            // A complex step stays on the chosen model; over the warning it asks before sending.
            await setSettings(page, AUTOPILOT_PAGE, { 'ingot.agent.cost.warnUsd': '0.0001' });
            const calls = server.calls.length;
            await composer(page).fill('refactor the cart module and split pricing from tax handling');
            await expect(forecast(page)).toHaveClass(/over/);
            await expect(forecast(page)).toHaveAttribute('data-model', 'ingot:ingot-mock');
            await composer(page).press('Enter');
            const confirm = page.locator('#ingot-cost-confirm');
            await expect(confirm).toContainText('over your');
            await expect(confirm).toContainText('Ingot Mock');
            expect(server.calls.length).toBe(calls);
            await shot(page, 'IDEA-307-cost-warning-light.png');
            await page.locator('#ingot-cost-send').click();
            await expect(confirm).toHaveCount(0);
            await expect(lastReply(page)).toContainText('Echo: refactor the cart module', { timeout: 60_000 });
            expect(server.calls.at(-1)?.model).toBe('ingot-mock');
            await setAppearance(page, 'dark');
            await composer(page).fill('refactor the checkout');
            await composer(page).press('Enter');
            await expect(confirm).toBeVisible();
            await shot(page, 'IDEA-307-cost-warning-dark.png');
            await page.locator('#ingot-cost-cancel').click();
            await expect(confirm).toHaveCount(0);
            expect(server.calls.at(-1)?.model).toBe('ingot-mock');

            // Find Action turns the router off; Habits lists the learned model.
            await runCommand(page, 'Agents: Toggle Autopilot Model Router');
            await page.locator('#ingot-composer-more').click();
            await expect(page.locator('#ingot-composer-router')).toHaveText('Router off');
            await page.locator('#ingot-composer-more').click();
            await openSettingsPage(page, HABITS_PAGE);
            await expect(page.locator('#ingot-learned-habits [data-learned="model-choice:rename"]')).toContainText(/Ingot Fast for rename tasks/i);
            await page.locator('#ingot-learned-habits').scrollIntoViewIfNeeded();
            await shot(page, 'IDEA-307-habits-page-dark.png');
            await page.locator('#ingot-settings-cancel').click();
        } finally {
            await disableHabits(page);
            await setSettings(page, AUTOPILOT_PAGE, { 'ingot.agent.router.enabled': false, 'ingot.agent.cost.warnUsd': '0.5' });
            await setByok(page, true);
            await setSettings(page, 'appearance', { 'ingot.appearance': appearance });
        }
    });
});
