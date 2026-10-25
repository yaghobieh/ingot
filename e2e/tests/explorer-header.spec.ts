import { expect, test } from '@playwright/test';
import { openIngot } from '../src/app.utils';

/** IDEA-93: Project header = chevron + project name + New File, New Folder, Refresh, Collapse All. */
test.describe('IDEA-93 project header', () => {
    test('shows the name with a fold chevron and the four file actions in order', async ({ page }) => {
        await openIngot(page);
        const bar = page.locator('#theia-left-content-panel .theia-sidepanel-toolbar');
        await expect(bar.locator('.theia-sidepanel-title')).toHaveText('sample-project');
        await expect(bar).not.toContainText(/project:/i);

        const ids = ['new-file', 'new-folder', 'refresh', 'collapse-all'];
        const xs: number[] = [];
        for (const id of ids) {
            const icon = bar.locator(`#ingot-explorer-${id}`);
            await expect(icon).toBeVisible();
            xs.push((await icon.boundingBox())!.x);
        }
        expect([...xs].sort((a, b) => a - b)).toEqual(xs);

        // The chevron folds and unfolds the tree; the choice survives a reload.
        const tree = page.locator('#explorer-view-container .theia-TreeNode').first();
        await expect(tree).toBeVisible();
        await page.locator('#ingot-explorer-toggle').click();
        await expect(page.locator('#ingot-explorer-toggle')).toHaveAttribute('aria-expanded', 'false');
        await expect(tree).toBeHidden();
        await page.reload();
        await expect(page.locator('#ingot-explorer-toggle')).toHaveAttribute('aria-expanded', 'false');
        await page.locator('#ingot-explorer-toggle').click();
        await expect(page.locator('#explorer-view-container .theia-TreeNode').first()).toBeVisible();

        // New File asks for a name.
        await bar.locator('#ingot-explorer-new-file').click();
        await expect(page.locator('.dialogBlock, .quick-input-widget').first()).toBeVisible();
        await page.keyboard.press('Escape');

        // Other views keep their own title without the chevron.
        await page.locator('#shell-tab-search-view-container').click();
        await expect(page.locator('#ingot-explorer-toggle')).toBeHidden();
        await expect(page.locator('#ingot-explorer-new-file')).toBeHidden();
    });
});
