import { expect, test, type Locator, type Page } from '@playwright/test';
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

/** IDEA-174: max space between the composer's bottom edge and the panel's bottom (its margin plus the one-line disclaimer). */
const COMPOSER_BOTTOM_SLACK_PX = 48;

const box = async (locator: Locator): Promise<{ y: number; height: number; bottom: number }> => {
    const b = await locator.boundingBox();
    expect(b).not.toBeNull();
    return { y: b!.y, height: b!.height, bottom: b!.y + b!.height };
};

/** The composer sits at the bottom of the chat panel, with the empty-state title right above it - never in the middle. */
const expectComposerAtBottom = async (page: Page, panel: 'right' | 'bottom'): Promise<void> => {
    const chat = chatIn(page, panel);
    await expect(chat.locator('.ingot-composer')).toBeVisible();
    await expect(chat.locator('#ingot-agents-empty-state')).toBeVisible();
    const root = await box(chat.locator('.ingot-agents-root'));
    const composer = await box(chat.locator('.ingot-composer'));
    const title = await box(chat.locator('#ingot-agents-empty-state'));
    expect(root.bottom - composer.bottom).toBeGreaterThanOrEqual(0);
    expect(root.bottom - composer.bottom).toBeLessThanOrEqual(COMPOSER_BOTTOM_SLACK_PX);
    expect(composer.y).toBeGreaterThan(root.y + root.height / 2);
    expect(title.bottom).toBeLessThanOrEqual(composer.y);
    expect(composer.y - title.bottom).toBeLessThanOrEqual(COMPOSER_BOTTOM_SLACK_PX);
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

    test('IDEA-174: the composer is pinned to the bottom of the chat, docked right and at the bottom', async ({ page }) => {
        await resetLayout(page);
        await page.locator('#ingot-agents-new').click();
        await expectComposerAtBottom(page, 'right');

        await moveChat(page, 'Chat at the Bottom');
        await expect(chatIn(page, 'bottom')).toBeVisible();
        await expectComposerAtBottom(page, 'bottom');

        await moveChat(page, 'Chat on the Right');
        await expect(chatIn(page, 'right')).toBeVisible();
        await expectComposerAtBottom(page, 'right');
    });
});
