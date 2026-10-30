import type { Page } from '@playwright/test';

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

/** Picks a chat mode from the mode dropdown in the composer bar (IDEA-77). */
export const pickMode = async (page: Page, id: string): Promise<void> => {
    await page.locator('#ingot-composer-mode').click();
    await page.locator(`#ingot-mode-${id}`).click();
};
