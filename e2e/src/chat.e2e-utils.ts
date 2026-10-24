import type { Page } from '@playwright/test';

/** Picks a model in the composer's model popover (IDEA-77). */
export const pickModel = async (page: Page, id: string): Promise<void> => {
    await page.locator('#ingot-composer-model').click();
    await page.locator(`#ingot-model-picker [data-model="${id}"]`).first().click();
};

/** Picks a chat mode in the composer's mode menu (IDEA-77). */
export const pickMode = async (page: Page, id: string): Promise<void> => {
    await page.locator('#ingot-composer-mode').click();
    await page.locator(`#ingot-mode-${id}`).click();
};
