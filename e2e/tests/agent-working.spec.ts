import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';

/**
 * The agent's "working" state: "Getting it done…" with a bright band sweeping across it every 1.5 s, in light and
 * dark. "Thinking…" stands in for it while a thought streams. Reduced motion shows plain text.
 */
const THOUGHT = 'Look at the cart module first, then check how totals are rounded before changing anything. '.repeat(2);
const ANSWER = 'The cart total now rounds once at the end, so the sum of the lines matches the total shown at checkout. '.repeat(3);
const STREAM = { chunkSize: 4, delayMs: 90 };
const LIGHT_GLINT_MIN = 200;

/** Brightness (0–255) of the shimmer's base and glint colors, resolved by the browser. */
const shimmerColors = (target: Locator): Promise<{ base: number; glint: number }> => target.evaluate(el => {
    const brightness = (name: string): number => {
        const probe = document.createElement('span');
        probe.style.color = `var(${name})`;
        el.appendChild(probe);
        const color = getComputedStyle(probe).color;
        probe.remove();
        // color-mix() resolves to `color(srgb 0.87 0.88 0.9)` (0–1), plain colors to `rgb(…)` (0–255).
        const scale = color.startsWith('color(') ? 255 : 1;
        const [r, g, b] = (color.match(/[\d.]+/g) ?? []).map(n => Number(n) * scale);
        return Math.round((r * 299 + g * 587 + b * 114) / 1000);
    };
    return { base: brightness('--ingot-shimmer-base'), glint: brightness('--ingot-shimmer-glint') };
});

const openSettingsPage = async (page: Page, id: string): Promise<void> => {
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), page.locator('#ingot-settings'));
    await page.locator(`#ingot-settings-node-${id}`).click();
};

test.describe('Agent working state shimmer', () => {
    test.setTimeout(150_000);
    let dir: string;
    let server: FakeOllama;

    test.beforeEach(async () => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-working-')));
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'cart', private: true }, undefined, 2));
        server = await startFakeOllama((_system, user) => user.startsWith('think') ? `<think>${THOUGHT}</think>\n${ANSWER}` : ANSWER, STREAM);
    });

    test.afterEach(async () => {
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('"Getting it done…" shimmers in light and dark, gives way to Thinking…, and stops for reduced motion', async ({ page }) => {
        await openIngot(page, dir);
        await openSettingsPage(page, 'appearance');
        const appearance = await page.locator('#ingot-setting-ingot-appearance').inputValue();
        await page.locator('#ingot-settings-cancel').click();
        try {
            await setAppearance(page, 'light');
            await connectOllama(page, server);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            await dismissNotifications(page);
            const composer = page.locator('#ingot-composer-input');
            const working = page.locator('#ingot-chat-working');
            const text = working.locator('.ingot-shimmer');

            // Light: muted text with a near-white band sliding across it, 1.5 s per sweep, forever.
            await composer.fill('fix the cart total rounding');
            await composer.press('Enter');
            await expect(text).toHaveText('Getting it done…');
            await expect(text).toHaveCSS('animation-name', 'ingot-shimmer-sweep');
            await expect(text).toHaveCSS('animation-duration', '1.5s');
            await expect(text).toHaveCSS('animation-iteration-count', 'infinite');
            await expect(text).toHaveCSS('color', 'rgba(0, 0, 0, 0)');
            await expect(text).toHaveCSS('background-image', /linear-gradient/);
            const light = await shimmerColors(text);
            expect(light.glint).toBeGreaterThan(LIGHT_GLINT_MIN);
            expect(light.glint).toBeGreaterThan(light.base);
            const start = await text.evaluate(el => getComputedStyle(el).backgroundPosition);
            await expect.poll(() => text.evaluate(el => getComputedStyle(el).backgroundPosition)).not.toBe(start);
            await shot(page, 'agent-working-light.png');
            await expect(working).toHaveCount(0, { timeout: 60_000 });
            await expect(page.locator('#ingot-agents .ingot-chat-agent .ingot-md').last()).toContainText('rounds once at the end');

            // Dark: the same sweep with the bright text color as the band.
            await setAppearance(page, 'dark');
            await composer.fill('and the tax line');
            await composer.press('Enter');
            await expect(text).toHaveText('Getting it done…');
            await expect(text).toHaveCSS('animation-name', 'ingot-shimmer-sweep');
            const dark = await shimmerColors(text);
            expect(dark.glint).toBeGreaterThan(dark.base);
            await shot(page, 'agent-working-dark.png');
            await expect(working).toHaveCount(0, { timeout: 60_000 });

            // While a thought streams, its "Thinking…" row shimmers instead of the working line.
            await composer.fill('think about the discount');
            await composer.press('Enter');
            const thinking = page.locator('#ingot-agents .ingot-chat-thought.thinking .ingot-chat-thought-label');
            await expect(thinking).toHaveClass(/ingot-shimmer/);
            await expect(thinking).toHaveCSS('animation-name', 'ingot-shimmer-sweep');
            await expect(working).toHaveCount(0);
            await shot(page, 'agent-thinking-dark.png');
            await expect(text).toHaveText('Getting it done…', { timeout: 30_000 });
            await expect(working).toHaveCount(0, { timeout: 60_000 });

            // Reduced motion: no sweep, plain muted text.
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await composer.fill('one more pass');
            await composer.press('Enter');
            await expect(text).toHaveText('Getting it done…');
            await expect(text).toHaveCSS('animation-name', 'none');
            await expect(text).toHaveCSS('background-image', 'none');
            await expect(text).not.toHaveCSS('color', 'rgba(0, 0, 0, 0)');
            await page.locator('#ingot-composer-stop').click();
            await expect(working).toHaveCount(0);
        } finally {
            await page.emulateMedia({ reducedMotion: 'no-preference' });
            if (await page.locator('#ingot-settings').isVisible()) {
                await page.locator('#ingot-settings-cancel').click();
            }
            await openSettingsPage(page, 'appearance');
            await page.locator('#ingot-setting-ingot-appearance').selectOption(appearance);
            await page.locator('#ingot-settings-ok').click();
        }
    });
});
