import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { openIngot } from '../src/app.utils';
import { FIXTURES_DIR } from '../src/e2e.consts';

/** Reference-comparison screenshots (docs/design/ide-reference.png). Run with INGOT_SHOTS_DIR=<dir>. */
const SHOTS_DIR = process.env.INGOT_SHOTS_DIR;
const SHOP = path.join(FIXTURES_DIR, 'shop-frontend');

const tree = (page: Page, name: string) => page.locator('#explorer-view-container .theia-TreeNode', { hasText: new RegExp(`^${name.replace('.', '\\.')}$`) }).first();

const openFile = async (page: Page, name: string): Promise<void> => {
    await tree(page, name).dblclick();
    await expect(page.locator('.lm-TabBar-tab', { hasText: name }).first()).toBeVisible();
};

test.describe('Reference look screenshots', () => {
    test.skip(!SHOTS_DIR, 'set INGOT_SHOTS_DIR to capture reference comparison screenshots');

    for (const scheme of ['light', 'dark'] as const) {
        test(`main window (${scheme})`, async ({ page }) => {
            fs.mkdirSync(SHOTS_DIR!, { recursive: true });
            await page.emulateMedia({ colorScheme: scheme });
            await openIngot(page, SHOP);
            await expect(page.locator('body')).toHaveClass(new RegExp(`ingot-${scheme}`));
            await page.locator('#ingot-tb-theme').click();
            await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'System' }).first().click();
            for (const [folder, child] of [['src', 'hooks'], ['hooks', 'useCart.ts'], ['lib', 'api.ts']]) {
                await expect(async () => {
                    if (!(await tree(page, child).isVisible())) {
                        await tree(page, folder).click();
                    }
                    await expect(tree(page, child)).toBeVisible({ timeout: 1_500 });
                }).toPass({ timeout: 20_000 });
            }
            await expect(page.locator('body')).toHaveClass(new RegExp(`ingot-${scheme}`));
            await page.locator('#ingot-tb-theme').click();
            await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'System' }).first().click();
            for (const folder of ['src', 'hooks', 'lib']) {
                const node = page.locator('#explorer-view-container .theia-TreeNode', { hasText: new RegExp(`^${folder}$`) }).first();
                if (await node.locator('.theia-mod-collapsed').count()) {
                    await node.click();
                }
                await page.waitForTimeout(150);
            }
            await expect(page.locator('body')).toHaveClass(new RegExp(`ingot-${scheme}`));
            await openFile(page, 'api.ts');
            await openFile(page, 'useCart.ts');
            if (!(await page.locator('#ingot-agents').isVisible().catch(() => false))) {
                await page.locator('#ingot-tb-agents').click();
            }
            await page.waitForTimeout(800);
            await page.screenshot({ path: path.join(SHOTS_DIR!, `ingot-${scheme}.png`) });
        });
    }
});
