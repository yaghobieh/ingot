import type { Page } from '@playwright/test';

/** Picks a model in the composer's model popover (IDEA-77): typed into the search, as the family submenus (IDEA-91) need hover. */
export const pickModel = async (page: Page, id: string): Promise<void> => {
    await page.locator('#ingot-composer-model').click();
    const direct = page.locator(`#ingot-model-picker [data-model="${id}"]`).first();
    if (!await direct.isVisible()) {
        const family = page.locator(`#ingot-model-picker .ingot-pick-family`);
        for (let i = 0; i < await family.count() && !await direct.isVisible(); i++) {
            await family.nth(i).hover();
        }
    }
    await direct.click();
};

/** Picks a chat mode in the composer's mode menu (IDEA-77). */
export const pickMode = async (page: Page, id: string): Promise<void> => {
    await page.locator('#ingot-composer-mode').click();
    await page.locator(`#ingot-mode-${id}`).click();
};
