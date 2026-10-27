import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';

/** IDEA-175: one height for every composer control, tooltips, brand-gold send, neutral model pill. Screenshots with INGOT_SHOTS_DIR=<dir>. */
const SHOTS_DIR = process.env.INGOT_SHOTS_DIR;
const BAR = '.ingot-agents .ingot-composer-bar';
const GOLD = 'rgb(217, 160, 78)';

const useScheme = async (page: Page, scheme: 'light' | 'dark'): Promise<void> => {
    await page.emulateMedia({ colorScheme: scheme });
    await openIngot(page);
    await page.locator('#ingot-rs-theme').click();
    await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'System' }).first().click();
    await expect(page.locator('body')).toHaveClass(new RegExp(`ingot-${scheme}`));
    await dismissNotifications(page);
};

const style = (page: Page, selector: string, prop: string): Promise<string> =>
    page.locator(selector).first().evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

for (const scheme of ['light', 'dark'] as const) {
    test(`IDEA-175 composer toolbar is consistent (${scheme})`, async ({ page }) => {
        await useScheme(page, scheme);
        await page.locator('#ingot-agents-new').click();
        const bar = page.locator(BAR);
        await expect(bar).toBeVisible();

        // Every control in the bar has the same height and a tooltip.
        const controls = ['#ingot-composer-attach', '#ingot-composer-mode', '#ingot-composer-model', '#ingot-composer-review', '#ingot-composer-zaprex', '#ingot-composer-send'];
        for (const id of controls) {
            const box = await page.locator(id).boundingBox();
            expect(box, id).not.toBeNull();
            expect(Math.round(box!.height), `${id} height`).toBe(26);
            expect(await page.locator(id).getAttribute('title'), `${id} tooltip`).toBeTruthy();
        }
        const mic = page.locator('#ingot-composer-mic');
        if (await mic.count()) {
            expect(Math.round((await mic.boundingBox())!.height)).toBe(26);
        }

        // IDEA-184: borderless ghost pills, a review toggle with no filled circle, the animated T-rex.
        for (const id of ['#ingot-composer-mode', '#ingot-composer-model']) {
            expect(await style(page, id, 'border-top-color'), `${id} border`).toBe('rgba(0, 0, 0, 0)');
            expect(await style(page, id, 'background-color'), `${id} background`).toBe('rgba(0, 0, 0, 0)');
        }
        expect(await style(page, '#ingot-composer-review', 'background-color')).toBe('rgba(0, 0, 0, 0)');
        await expect(page.locator('#ingot-composer-review .codicon-eye, #ingot-composer-review.codicon-eye')).toHaveCount(0);
        await expect(page.locator('#ingot-composer-review .codicon-checklist')).toBeVisible();
        if (await page.locator('#ingot-composer-review').getAttribute('aria-pressed') === 'true') {
            await expect(page.locator('#ingot-composer-review .ingot-composer-review-dot')).toBeVisible();
        }
        const trex = page.locator('#ingot-composer-zaprex .ingot-zaprex-trex');
        await expect(trex).toBeVisible();
        expect(await style(page, '#ingot-composer-zaprex', 'background-color')).toBe('rgba(0, 0, 0, 0)');
        expect(await trex.evaluate(el => getComputedStyle(el).animationName)).toBe('ingot-trex-idle');
        await expect(page.locator('#ingot-composer-zaprex')).toHaveAttribute('title', 'Zaprex · Harmony mode on');

        // The model pill is never painted warning orange, ready or not.
        const modelColor = await style(page, '#ingot-composer-model', 'color');
        const textColor = await style(page, '.ingot-agents .ingot-composer-input', 'color');
        expect(modelColor).toBe(textColor);

        // Send: muted while empty, brand gold with a tooltip once there is text.
        const send = page.locator('#ingot-composer-send');
        await expect(send).toBeDisabled();
        expect(await style(page, '#ingot-composer-send', 'background-color')).not.toBe(GOLD);
        await expect(send).toHaveAttribute('title', 'Type a message to send');
        if (SHOTS_DIR) {
            fs.mkdirSync(SHOTS_DIR, { recursive: true });
            await page.locator('.ingot-agents .ingot-composer').screenshot({ path: path.join(SHOTS_DIR, `composer-toolbar-empty-${scheme}.png`) });
        }
        await page.locator('#ingot-composer-input').click();
        await page.keyboard.type('Refactor the cart hook');
        await expect(send).toBeEnabled();
        await expect.poll(() => style(page, '#ingot-composer-send', 'background-color')).toBe(GOLD);
        await expect(send).toHaveAttribute('title', 'Send (Enter)');

        // Keyboard focus shows a ring; hover fills the pill.
        await page.locator('#ingot-composer-mode').focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect.poll(() => style(page, '#ingot-composer-mode', 'outline-style')).toBe('solid');
        await page.locator('#ingot-composer-model').hover();
        await expect.poll(() => style(page, '#ingot-composer-model', 'background-color')).not.toBe('rgba(0, 0, 0, 0)');
        if (SHOTS_DIR) {
            await page.mouse.move(0, 0);
            await page.locator('#ingot-composer-input').focus();
            await page.locator('.ingot-agents .ingot-composer').screenshot({ path: path.join(SHOTS_DIR, `composer-toolbar-typed-${scheme}.png`) });
            await page.locator('.ingot-agents').screenshot({ path: path.join(SHOTS_DIR, `composer-panel-${scheme}.png`) });
        }
    });
}
