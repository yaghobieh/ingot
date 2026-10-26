import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { SHELL_SELECTOR } from '../src/e2e.consts';

const item = (page: Page, label: string) => page.locator('.lm-Menu .lm-Menu-item', { has: page.locator('.lm-Menu-itemLabel', { hasText: new RegExp(`^${label}$`) }) });
const stripeIds = (page: Page) => page.locator('.ingot-rs-group:not(.ingot-rs-bottom) .ingot-rs-button').evaluateAll(els => els.map(e => e.id));
const leftTabIds = (page: Page) => page.locator('.lm-TabBar.theia-app-left .lm-TabBar-tab').evaluateAll(els => els.map(e => e.id));
const reload = async (page: Page): Promise<void> => {
    await page.reload();
    await page.locator(SHELL_SELECTOR).waitFor({ timeout: 120_000 });
    await expect(page.locator('#ingot-rs-agents')).toBeVisible({ timeout: 60_000 });
    await dismissNotifications(page);
};
const PROBLEMS_TAB = '#shell-tab-problems';
/** HTML5 drag: press on the source, move over the target in steps (dragover needs repeats), release. */
const dragOnto = async (page: Page, source: string, target: string): Promise<void> => {
    const from = (await page.locator(source).boundingBox())!;
    const to = (await page.locator(target).boundingBox())!;
    await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2);
    await page.mouse.down();
    for (let i = 1; i <= 8; i++) {
        await page.mouse.move(from.x + from.width / 2, from.y + from.height / 2 + (to.y - from.y) * i / 8);
    }
    await page.mouse.move(to.x + to.width / 2, to.y + to.height / 2);
    await page.mouse.up();
};

/** IDEA-127: customize the window layout and keep it per workspace. */
test.describe('IDEA-127 layout customization', () => {
    test('drag a right stripe icon to reorder it; the order survives a reload', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        const before = await stripeIds(page);
        await dragOnto(page, '#ingot-rs-mcp', '#ingot-rs-notifications');
        await expect.poll(() => stripeIds(page)).toEqual(['ingot-rs-mcp', ...before.filter(id => id !== 'ingot-rs-mcp')]);
        await reload(page);
        await expect.poll(() => stripeIds(page)).toEqual(['ingot-rs-mcp', ...before.filter(id => id !== 'ingot-rs-mcp')]);
    });

    test('drag a left stripe tab to reorder it, move Problems to the left and back; Reset Layout restores the default', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        const defaultStripe = await stripeIds(page);
        const tabs = await leftTabIds(page);
        expect(tabs.length).toBeGreaterThan(2);

        // Drag the first tab below the third.
        const first = (await page.locator(`#${tabs[0]}`).boundingBox())!;
        const third = (await page.locator(`#${tabs[2]}`).boundingBox())!;
        await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2);
        await page.mouse.down();
        for (let i = 1; i <= 10; i++) {
            await page.mouse.move(first.x + first.width / 2, first.y + first.height / 2 + (third.y + third.height * 0.8 - first.y - first.height / 2) * i / 10);
        }
        await page.mouse.up();
        await expect.poll(async () => (await leftTabIds(page)).indexOf(tabs[0])).toBeGreaterThan(0);

        // Right-click a bottom tab › Move to › Move to Left.
        await page.locator('.ingot-right-stripe').click({ button: 'right', position: { x: 10, y: 200 } });
        await item(page, 'Problems').click();
        await page.locator(`#theia-bottom-content-panel ${PROBLEMS_TAB}`).click({ button: 'right' });
        await item(page, 'Move to').hover();
        await expect(item(page, 'Move to Bottom')).toHaveCount(0);
        await item(page, 'Move to Left').click();
        await expect(page.locator(`.lm-TabBar.theia-app-left ${PROBLEMS_TAB}`)).toBeVisible();
        await expect(page.locator(`#theia-bottom-content-panel ${PROBLEMS_TAB}`)).toHaveCount(0);

        await reload(page);
        await expect(page.locator(`.lm-TabBar.theia-app-left ${PROBLEMS_TAB}`)).toBeVisible();
        expect((await leftTabIds(page)).indexOf(tabs[0])).toBeGreaterThan(0);

        // The left stripe's menu moves it back: right-click its icon › Move to › Move to Bottom.
        await page.locator(`.lm-TabBar.theia-app-left ${PROBLEMS_TAB}`).click({ button: 'right' });
        await item(page, 'Move to').hover();
        await item(page, 'Move to Bottom').click();
        await expect(page.locator(`#theia-bottom-content-panel ${PROBLEMS_TAB}`)).toBeVisible();
        await page.locator(`#theia-bottom-content-panel ${PROBLEMS_TAB}`).click({ button: 'right' });
        await item(page, 'Move to').hover();
        await item(page, 'Move to Right').click();
        await expect(page.locator(`#theia-right-content-panel ${PROBLEMS_TAB}`)).toBeAttached();

        // Gear › Reset Layout reloads with the default layout.
        await dragOnto(page, '#ingot-rs-mcp', '#ingot-rs-notifications');
        await page.locator('#ingot-stripe-settings').click();
        await Promise.all([page.waitForEvent('load', { timeout: 60_000 }), item(page, 'Reset Layout').click()]);
        await page.locator(SHELL_SELECTOR).waitFor({ timeout: 120_000 });
        await expect(page.locator('#ingot-rs-agents')).toBeVisible({ timeout: 60_000 });
        await expect.poll(() => leftTabIds(page)).toEqual(tabs);
        await expect(page.locator(`#theia-right-content-panel ${PROBLEMS_TAB}`)).toHaveCount(0);
        await expect.poll(() => stripeIds(page)).toEqual(defaultStripe);
    });

    test('double-click the sidebar divider fits it to its content; again restores', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        const panel = page.locator('#theia-left-content-panel');
        await expect(panel).toBeVisible();
        const width = () => panel.evaluate(el => (el as HTMLElement).offsetWidth);
        const before = await width();
        const handle = await panel.evaluate(el => {
            const right = el.getBoundingClientRect().right;
            const h = Array.from(document.querySelectorAll('.lm-SplitPanel-handle')).map(x => x.getBoundingClientRect())
                .find(r => r.height > 100 && r.height > r.width && Math.abs(r.left - right) <= 10);
            return h && { x: h.left + h.width / 2, y: h.top + h.height / 2 };
        });
        expect(handle).toBeTruthy();
        await page.mouse.dblclick(handle!.x, handle!.y);
        await expect(panel).toHaveAttribute('data-ingot-fit', 'fitted');
        await expect.poll(width).not.toBe(before);
        const fitted = await width();
        expect(fitted).toBeLessThanOrEqual(page.viewportSize()!.width * 0.6 + 1);

        const again = await panel.evaluate(el => {
            const right = el.getBoundingClientRect().right;
            const h = Array.from(document.querySelectorAll('.lm-SplitPanel-handle')).map(x => x.getBoundingClientRect())
                .find(r => r.height > 100 && r.height > r.width && Math.abs(r.left - right) <= 10);
            return h && { x: h.left + h.width / 2, y: h.top + h.height / 2 };
        });
        await page.mouse.dblclick(again!.x, again!.y);
        await expect(panel).toHaveAttribute('data-ingot-fit', 'restored');
        await expect.poll(async () => Math.abs((await width()) - before)).toBeLessThanOrEqual(2);
    });
});
