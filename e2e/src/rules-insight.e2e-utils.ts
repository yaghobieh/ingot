import { expect, type Page } from '@playwright/test';
import { runCommand } from './app.utils';
import { APPEARANCE_COMMAND, SHOT_MODES, THEME_BODY_CLASS, THEME_SETTLE_MS } from './rules-insight.e2e-consts';

/** Picks Light, Dark or System from the theme command, like a user would. */
export const setAppearance = async (page: Page, label: string): Promise<void> => {
    await runCommand(page, APPEARANCE_COMMAND);
    await page.locator('.quick-input-widget .monaco-list-row', { hasText: label }).first().click();
    const themeClass = THEME_BODY_CLASS[label];
    if (themeClass) {
        await expect(page.locator('body')).toHaveClass(themeClass);
    }
};

/**
 * Saves `ingot-<feature>-light.png` and `-dark.png` to SHOTS_DIR (skipped when unset), then goes back to System so
 * later specs keep the default theme.
 */
export const shootLightAndDark = async (page: Page, feature: string, before?: () => Promise<void>): Promise<void> => {
    const dir = process.env.SHOTS_DIR;
    if (!dir) {
        return;
    }
    for (const { mode, label } of SHOT_MODES) {
        await setAppearance(page, label);
        await before?.();
        await page.waitForTimeout(THEME_SETTLE_MS);
        await page.screenshot({ path: `${dir}/ingot-${feature}-${mode}.png` });
    }
    await setAppearance(page, 'System');
};

/** Opens a project file through Go to File (Ctrl+P). */
export const openFile = async (page: Page, relativePath: string, expectText: string): Promise<void> => {
    const name = relativePath.split('/').pop()!;
    await expect(async () => {
        await page.keyboard.press('Escape');
        await page.keyboard.press('Control+p');
        await expect(page.locator('.quick-input-widget input')).toBeVisible({ timeout: 2_000 });
        await page.locator('.quick-input-widget input').fill(relativePath);
        await page.locator('.quick-input-widget .monaco-list-row', { hasText: name }).first().click({ timeout: 3_000 });
        await expect(page.locator('#theia-main-content-panel .lm-TabBar-tab.lm-mod-current', { hasText: name })).toBeVisible({ timeout: 3_000 });
        await expect(page.locator('.monaco-editor .view-lines').first()).toContainText(expectText, { timeout: 3_000 });
    }).toPass({ timeout: 40_000 });
};
