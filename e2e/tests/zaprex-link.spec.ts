import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot, runCommand } from '../src/app.utils';

/** Optional: where to save review screenshots (outside the repo). */
const SHOTS = process.env.INGOT_SCREENSHOT_DIR;
const ZAPREX_APP_URL = 'https://zaprex.dev/app';

const setTheme = async (page: Page, label: string): Promise<void> => {
    await runCommand(page, 'Preferences: Color Theme');
    await page.locator('.quick-input-widget input').fill(label);
    await page.locator('.quick-input-list .monaco-list-row', { hasText: label }).first().click();
    await expect(page.locator('body')).toHaveClass(new RegExp(label === 'Ingot Dark' ? 'theia-dark' : 'theia-light'));
};

const shotHeader = async (page: Page, name: string): Promise<void> => {
    if (!SHOTS) { return; }
    fs.mkdirSync(SHOTS, { recursive: true });
    const header = page.locator('.ingot-tb-window-actions').first();
    const box = await header.boundingBox();
    if (box) {
        await page.screenshot({ path: path.join(SHOTS, `${name}-header.png`), clip: { x: Math.max(0, box.x - 8), y: Math.max(0, box.y - 8), width: box.width + 16, height: box.height + 16 } });
    }
    await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
};

/** IDEA-173 / IDEA-179: Zaprex is its own app. The IDE has no Zaprex panel, one small T-rex in the title bar (plus the composer button, IDEA-184) that opens it. */
test.describe('IDEA-173 Zaprex link', () => {
    test('the title bar shows the one Zaprex T-rex (not in the agent header), which opens the Zaprex app', async ({ page, context }) => {
        await context.route('https://zaprex.dev/**', route => route.fulfill({ status: 200, contentType: 'text/html', body: '<title>Zaprex</title>' }));
        await openIngot(page);
        await dismissNotifications(page);
        const logo = page.locator('#ingot-tb-zaprex');
        await expect(logo).toBeVisible();
        // One T-rex in the title bar; the only other one is the composer button (IDEA-184), never the agent header.
        await expect(logo.locator('.ingot-zaprex-link-icon')).toHaveCount(1);
        await expect(page.locator('.ingot-zaprex-link-icon:not(#ingot-tb-zaprex *):not(#ingot-composer-zaprex *)')).toHaveCount(0);
        await expect(page.locator('#ingot-composer-zaprex')).toHaveCount(await page.locator('.ingot-agents .ingot-composer-bar').count());
        await expect(page.locator('#ingot-agents-zaprex')).toHaveCount(0);
        expect(await logo.locator('.ingot-zaprex-trex').evaluate(el => getComputedStyle(el).animationName)).toBe('ingot-trex-idle');
        await expect(logo).toHaveAttribute('title', 'Open Zaprex');
        await expect(logo).toHaveAttribute('aria-label', 'Open Zaprex');
        // Small: the same size class as the other header icons.
        const box = await logo.boundingBox();
        expect(box?.width ?? 0).toBeLessThanOrEqual(28);
        // No embedded Zaprex panel any more.
        await expect(page.locator('#ingot-bot-root')).toHaveCount(0);

        await setTheme(page, 'Ingot Light');
        await shotHeader(page, 'ide-titlebar-zaprex-light');
        await setTheme(page, 'Ingot Dark');
        await expect(logo).toBeVisible();
        await shotHeader(page, 'ide-titlebar-zaprex-dark');
        // The T-rex stands alone on a transparent background: no circle or tile behind it, even on hover.
        await logo.hover();
        await expect.poll(() => logo.locator('.ingot-zaprex-trex').evaluate(el => getComputedStyle(el).animationName)).toBe('ingot-trex-hop');
        const backgrounds = await logo.evaluate(element => [element, element.firstElementChild!].map(node => getComputedStyle(node).backgroundColor));
        expect(backgrounds).toEqual(['rgba(0, 0, 0, 0)', 'rgba(0, 0, 0, 0)']);

        const popup = page.waitForEvent('popup');
        await logo.click();
        const opened = await popup;
        expect(opened.url()).toBe(ZAPREX_APP_URL);
        await opened.close();
        await setTheme(page, 'Ingot Light');
    });

    test('the command palette has no Zaprex panel command', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        await page.keyboard.press('F1');
        const input = page.locator('.quick-input-widget input');
        await input.fill('>Zaprex');
        await expect(page.locator('.quick-input-list .monaco-list-row', { hasText: 'Zaprex' })).toHaveCount(0);
        await page.keyboard.press('Escape');
    });
});
