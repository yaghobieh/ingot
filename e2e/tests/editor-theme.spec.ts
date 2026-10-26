import { expect, test, type Page } from '@playwright/test';
import { openIngot, runCommand } from '../src/app.utils';

const THEMES = {
    light: { id: 'light', editorBg: 'rgb(255, 255, 255)', keyword: 'rgb(0, 51, 179)' },
    dark: { id: 'dark', editorBg: 'rgb(30, 31, 34)', keyword: 'rgb(207, 142, 109)' }
} as const;

const keywordColor = (page: Page): Promise<string> =>
    page.locator('.monaco-editor .view-lines span span', { hasText: /^export$/ }).first().evaluate(el => getComputedStyle(el).color);
const editorBackground = (page: Page): Promise<string> =>
    page.locator('.monaco-editor-background').first().evaluate(el => getComputedStyle(el).backgroundColor);

const setTheme = async (page: Page, id: string): Promise<void> => {
    await runCommand(page, 'Welcome to Ingot');
    await page.locator(`#ingot-theme-${id}`).click();
    await page.locator('.lm-TabBar-tab', { hasText: 'math.ts' }).first().click();
};

test.describe('IDEA-35 Ingot editor color themes', () => {
    test('editor background and keyword colour follow the app theme', async ({ page }) => {
        await openIngot(page);
        await page.locator('#explorer-view-container .theia-TreeNode', { hasText: 'src' }).first().click();
        await page.locator('#explorer-view-container .theia-TreeNode', { hasText: 'math.ts' }).first().dblclick();
        await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('export');

        for (const theme of [THEMES.dark, THEMES.light]) {
            await setTheme(page, theme.id);
            await expect.poll(() => editorBackground(page)).toBe(theme.editorBg);
            await expect.poll(() => keywordColor(page)).toBe(theme.keyword);
        }
    });
});
