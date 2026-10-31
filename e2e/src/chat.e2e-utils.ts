import { expect, type Page } from '@playwright/test';

const OPEN_CHAT_TRY_MS = 3_000;
const OPEN_CHAT_TIMEOUT_MS = 30_000;

/** The plan gate (IDEA-271) closes the chat while signed out; after signing in, open it from the title bar when it is still closed. */
export const openChat = async (page: Page): Promise<void> => {
    const newChat = page.locator('#ingot-agents-new');
    await expect(async () => {
        if (!await newChat.isVisible()) {
            await page.locator('#ingot-tb-chat').click();
        }
        await expect(newChat).toBeVisible({ timeout: OPEN_CHAT_TRY_MS });
    }).toPass({ timeout: OPEN_CHAT_TIMEOUT_MS });
};

/** Picks a model in the composer's model popover (IDEA-77) by searching for it (families open with '>' since IDEA-91). */
export const pickModel = async (page: Page, id: string): Promise<void> => {
    await page.locator('#ingot-composer-model').click();
    const family = page.locator(`#ingot-model-picker .ingot-pick-family`);
    const target = page.locator(`#ingot-model-picker [data-model="${id}"]`).first();
    for (let i = 0; i < await family.count() && !await target.isVisible(); i++) {
        await family.nth(i).click();
        if (!await target.isVisible()) {
            await page.locator('#ingot-pick-back').click();
        }
    }
    await target.click();
};

/** Picks a chat mode from the composer's mode pill (IDEA-77, IDEA-280). */
export const pickMode = async (page: Page, id: string): Promise<void> => {
    await page.locator('#ingot-composer-mode').click();
    await page.locator(`#ingot-mode-${id}`).click();
};
