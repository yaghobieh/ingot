import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';

const SHOTS = process.env.INGOT_SCREENSHOT_DIR;
const GOLD = 'rgb(217, 160, 78)';
const NAVY = 'rgb(27, 38, 71)';
const item = (page: Page, label: string) => page.locator('.lm-Menu .lm-Menu-item', { has: page.locator('.lm-Menu-itemLabel', { hasText: new RegExp(`^${label}$`) }) });
const bottomTab = (page: Page, id: string) => page.locator(`#theia-bottom-content-panel #shell-tab-${id}`);

const openPanel = async (page: Page, label: string): Promise<void> => {
    await page.locator('.ingot-right-stripe').click({ button: 'right', position: { x: 10, y: 200 } });
    await item(page, label).click();
};
const pickTheme = async (page: Page, label: 'Light' | 'Dark'): Promise<void> => {
    await page.locator('#ingot-rs-theme').click();
    await page.keyboard.type(label);
    await page.keyboard.press('Enter');
    await expect(page.locator('body')).toHaveClass(label === 'Dark' ? /theia-dark/ : /theia-light/);
};

/** IDEA-121: bottom panel tabs: compact, icon + text, gold underline on the active tab, close on hover, navy hover in dark. */
test.describe('IDEA-121 bottom panel tabs', () => {
    for (const theme of ['Light', 'Dark'] as const) {
        test(`${theme}: gold active underline, one height, close on hover`, async ({ page }) => {
            await openIngot(page);
            await dismissNotifications(page);
            await pickTheme(page, theme);
            await openPanel(page, 'Terminal');
            await openPanel(page, 'Problems');
            const active = bottomTab(page, 'problems');
            await expect(active).toHaveClass(/lm-mod-current/);
            expect(await active.evaluate(el => getComputedStyle(el).boxShadow)).toContain(GOLD);
            const other = page.locator('#theia-bottom-content-panel .lm-TabBar-tab:not(.lm-mod-current)').first();
            await expect(other).toBeVisible();
            const heights = await page.locator('#theia-bottom-content-panel .lm-TabBar-tab').evaluateAll(els => els.map(e => Math.round(e.getBoundingClientRect().height)));
            expect(new Set(heights).size).toBe(1);
            expect(heights[0]).toBe(30);

            const close = other.locator('.lm-TabBar-tabCloseIcon');
            if (await close.count()) {
                expect(await close.evaluate(el => getComputedStyle(el).visibility)).toBe('hidden');
            }
            await other.hover();
            if (await close.count()) {
                await expect.poll(() => close.evaluate(el => getComputedStyle(el).visibility)).toBe('visible');
            }
            const hover = await other.evaluate(el => getComputedStyle(el).backgroundColor);
            expect(hover).toBe(theme === 'Dark' ? NAVY : 'rgba(27, 38, 71, 0.06)');
            if (SHOTS) {
                fs.mkdirSync(SHOTS, { recursive: true });
                await page.screenshot({ path: path.join(SHOTS, `121-bottom-tabs-${theme.toLowerCase()}.png`) });
            }
        });
    }
});
