import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';

/** IDEA-85: the AI chat moves between the right column and the bottom panel, and the choice survives a reload. */
const chatIn = (page: Page, panel: 'right' | 'bottom') => page.locator(`#theia-${panel}-content-panel #ingot-agents`);

const moveChat = async (page: Page, label: string): Promise<void> => {
    await page.locator('.ingot-agents-header').click({ button: 'right', position: { x: 160, y: 10 } });
    const item = page.locator('.lm-Menu .lm-Menu-item', { hasText: label });
    await expect(item).toBeVisible();
    await item.click();
};

/** Starts every test from the default (chat on the right), whatever an earlier run left behind. */
const resetLayout = async (page: Page): Promise<void> => {
    await openIngot(page);
    await dismissNotifications(page);
    await expect(page.locator('#ingot-agents')).toBeAttached({ timeout: 60_000 });
    if (await chatIn(page, 'bottom').count()) {
        await moveChat(page, 'Chat on the Right');
    }
};

test.describe('IDEA-85 layout positions', () => {
    test('right-click the chat header to dock the chat at the bottom, then back on the right', async ({ page }) => {
        await resetLayout(page);
        await expect(chatIn(page, 'right')).toBeVisible();

        await moveChat(page, 'Chat at the Bottom');
        await expect(chatIn(page, 'bottom')).toBeVisible();
        await expect(page.locator('body')).toHaveAttribute('data-ingot-chat', 'bottom');

        // Saved as a preference: still at the bottom after a reload.
        await page.reload();
        await expect(chatIn(page, 'bottom')).toBeVisible({ timeout: 60_000 });

        await moveChat(page, 'Chat on the Right');
        await expect(chatIn(page, 'right')).toBeVisible();
        await expect(page.locator('body')).toHaveAttribute('data-ingot-chat', 'right');
    });

    test('the AI stripe button offers the same layout menu', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        await page.locator('#ingot-rs-agents').click({ button: 'right' });
        await expect(page.locator('.lm-Menu .lm-Menu-item', { hasText: 'Chat at the Bottom' })).toBeVisible();
        await expect(page.locator('.lm-Menu .lm-Menu-item', { hasText: 'Chat on the Right' })).toBeVisible();
        await page.keyboard.press('Escape');
    });
});
