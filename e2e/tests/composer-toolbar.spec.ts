import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { tokenColor } from '../src/agent-tools.e2e-utils';
import { saveArtifact } from '../src/artifacts.e2e-utils';

/** IDEA-175 / IDEA-248, agent panel mock: 28px icon buttons, 26px pills, 30px accent send, Agent mode in the bar, extras in the overflow menu. */
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

const saveShot = async (page: Page, name: string): Promise<void> => {
    await saveArtifact(page.locator('.ingot-agents'), name);
    if (SHOTS_DIR) {
        fs.mkdirSync(SHOTS_DIR, { recursive: true });
        await page.locator('.ingot-agents').screenshot({ path: path.join(SHOTS_DIR, name), animations: 'disabled' });
    }
};

for (const scheme of ['light', 'dark'] as const) {
    test(`IDEA-175 composer toolbar is consistent (${scheme})`, async ({ page }) => {
        await useScheme(page, scheme);
        await page.locator('#ingot-agents-new').click();
        const bar = page.locator(BAR);
        await expect(bar).toBeVisible();
        const sendColor = await tokenColor(page, '--ingot-agent-accent');
        const sendText = await tokenColor(page, '--ingot-agent-accent-text');
        const card = await tokenColor(page, '--ingot-agent-card');
        const surface = await tokenColor(page, '--ingot-surface');
        const heights: Record<string, number> = { '#ingot-composer-attach': 28, '#ingot-composer-mode': 26, '#ingot-composer-more': 28, '#ingot-composer-model': 26, '#ingot-composer-send': 30 };

        const controls = ['#ingot-composer-attach', '#ingot-composer-mode', '#ingot-composer-more', '#ingot-composer-model', '#ingot-composer-send'];
        for (const id of controls) {
            const box = await page.locator(id).boundingBox();
            expect(box, id).not.toBeNull();
            expect(Math.round(box!.height), `${id} height`).toBe(heights[id]);
            expect(await page.locator(id).getAttribute('title'), `${id} tooltip`).toBeTruthy();
        }

        expect(await style(page, '#ingot-composer-model', 'border-top-color')).toBe('rgba(0, 0, 0, 0)');
        expect(await style(page, '#ingot-composer-model', 'background-color')).toBe('rgba(0, 0, 0, 0)');
        expect(await style(page, '#ingot-composer-more', 'background-color')).toBe('rgba(0, 0, 0, 0)');
        await expect(page.locator('.ingot-composer-bar #ingot-composer-mode .ingot-pill-label')).toHaveText('Agent');
        await expect(page.locator('#ingot-composer-review')).toHaveCount(0);
        await expect(page.locator('#ingot-composer-zaprex')).toHaveCount(0);
        await expect(page.locator('#ingot-tb-zaprex')).toBeVisible();

        expect(await style(page, '#ingot-composer-model', 'color')).toBe(await tokenColor(page, '--ingot-agent-text-2'));
        await expect(page.locator('.ingot-agents .ingot-composer')).toHaveCSS('background-color', card);

        await page.locator('#ingot-composer-more').click();
        await expect(page.locator('#ingot-composer-more-menu')).toBeVisible();
        await expect(page.locator('#ingot-composer-more-menu #ingot-composer-mode')).toHaveCount(0);
        await expect(page.locator('#ingot-composer-review')).toBeVisible();
        await expect(page.locator('#ingot-composer-more-menu')).toHaveCSS('background-color', surface);
        await saveShot(page, `composer-rex-menu-${scheme}.png`);
        await page.locator('#ingot-composer-more').click();
        await expect(page.locator('#ingot-composer-more-menu')).toBeHidden();

        const send = page.locator('#ingot-composer-send');
        // Send keeps the accent as in the mock; it stays disabled until there is text.
        await expect(send).toBeDisabled();
        expect(await style(page, '#ingot-composer-send', 'background-color')).toBe(sendColor);
        expect(sendColor).not.toBe(GOLD);
        await expect(send).toHaveAttribute('title', 'Type a message to send');
        await page.locator('#ingot-composer-input').click();
        await page.keyboard.type('Refactor the cart hook');
        await expect(send).toBeEnabled();
        await expect.poll(() => style(page, '#ingot-composer-send', 'background-color')).toBe(sendColor);
        await expect.poll(() => style(page, '#ingot-composer-send', 'color')).toBe(sendText);
        await expect(send).toHaveAttribute('title', 'Send (Enter)');

        await page.locator('#ingot-composer-more').focus();
        await page.keyboard.press('Shift+Tab');
        await page.keyboard.press('Tab');
        await expect.poll(() => style(page, '#ingot-composer-more', 'outline-style')).toBe('solid');
        await page.locator('#ingot-composer-model').hover();
        await expect.poll(() => style(page, '#ingot-composer-model', 'background-color')).not.toBe('rgba(0, 0, 0, 0)');
        await saveShot(page, `composer-toolbar-typed-${scheme}.png`);
    });
}
