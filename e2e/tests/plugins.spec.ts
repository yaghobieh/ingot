import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { CONFIG_PROJECT, E2E_CONFIG_DIR } from '../src/e2e.consts';
import { startFakeOpenVsx, type FakeOpenVsx } from '../src/fake-open-vsx';

const plugins = (page: Page) => page.locator('#ingot-plugins');
const row = (page: Page, id: string) => page.locator(`.ingot-plugin-row[data-id="${id}"]`);
const settings = (page: Page) => page.locator('#ingot-settings');
/** Settings › Plugins › Open Marketplace, like a user would. */
const openPlugins = async (page: Page): Promise<void> => {
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), settings(page));
    await page.locator('#ingot-settings-node-plugins').click();
    await page.locator('#ingot-settings-action-openPlugins').click();
    await expect(plugins(page)).toBeVisible();
};
const themeOptions = async (page: Page): Promise<string[]> => {
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), settings(page));
    const labels = await page.locator('#ingot-setting-workbench-colorTheme option').allTextContents();
    await page.locator('#ingot-settings-cancel').click();
    return labels;
};

// WIP: install/deploy works against the fake registry; the post-install steps are still being stabilised.
test.describe.fixme('IDEA-37 plugin store on Open VSX', () => {
    let registry: FakeOpenVsx;
    test.beforeEach(async () => { registry = await startFakeOpenVsx(); });
    test.afterEach(async () => {
        await registry.close();
        for (const dir of ['ingot-dev.dawn-theme-0.0.1', 'ingot-e2e.midnight-gold@1.0.0']) {
            fs.rmSync(path.join(E2E_CONFIG_DIR, 'deployedPlugins', dir), { recursive: true, force: true });
        }
    });

    test('search the marketplace, install a theme plugin, disable/enable and uninstall it', async ({ page }) => {
        await openIngot(page, CONFIG_PROJECT);
        await openPlugins(page);
        await expect(page.locator('#ingot-plugins-tab-marketplace')).toHaveAttribute('aria-selected', 'true');

        await page.locator('#ingot-plugins-category-themes').click();
        await expect(row(page, 'ingot-e2e.midnight-gold')).toBeVisible();
        await expect(row(page, 'ingot-e2e.harbor-blue')).toBeVisible();
        await page.locator('#ingot-plugins-search').fill('midnight');
        await expect(row(page, 'ingot-e2e.harbor-blue')).toHaveCount(0);
        await expect(row(page, 'ingot-e2e.midnight-gold')).toContainText('12K downloads');
        expect(registry.searches).toContain('midnight');

        await row(page, 'ingot-e2e.midnight-gold').locator('.ingot-plugin-install').click();
        await expect(row(page, 'ingot-e2e.midnight-gold').locator('.ingot-plugin-uninstall')).toBeVisible({ timeout: 60_000 });
        expect(registry.downloads).toContain('midnight-gold');
        await dismissNotifications(page);

        // The plugin's color theme is now offered in Settings › Appearance.
        await expect.poll(() => themeOptions(page), { timeout: 30_000 }).toContain('Midnight Gold');

        await page.locator('#ingot-plugins-tab-installed').click();
        const installed = row(page, 'ingot-e2e.midnight-gold');
        await expect(installed).toContainText('Theme');
        await installed.locator('.ingot-plugin-disable').click();
        await expect(installed.locator('.ingot-plugin-enable')).toBeVisible();
        await expect(installed).toContainText('Disabled');
        await expect(page.locator('#ingot-plugins-reload')).toBeVisible();
        await installed.locator('.ingot-plugin-enable').click();
        await expect(installed.locator('.ingot-plugin-disable')).toBeVisible();

        await installed.locator('.ingot-plugin-uninstall').click();
        await expect(row(page, 'ingot-e2e.midnight-gold')).toHaveCount(0, { timeout: 60_000 });
    });

    test('developers install their own plugin from a folder', async ({ page }) => {
        await openIngot(page, CONFIG_PROJECT);
        await openPlugins(page);
        await page.locator('#ingot-plugins-install-folder').click();
        const fileDialog = page.locator('.dialogBlock', { hasText: 'Install Plugin from Folder' });
        await expect(fileDialog).toBeVisible();
        await fileDialog.locator('.theia-TreeNode', { hasText: 'dawn-theme-plugin' }).click();
        await fileDialog.getByRole('button', { name: 'Install' }).click();
        await expect(page.locator('.theia-notification-message', { hasText: 'Installed plugin ingot-dev.dawn-theme' }).first()).toBeVisible({ timeout: 60_000 });
        await dismissNotifications(page);

        await page.locator('#ingot-plugins-tab-installed').click();
        await expect(row(page, 'ingot-dev.dawn-theme')).toBeVisible({ timeout: 30_000 });
        await expect.poll(() => themeOptions(page), { timeout: 30_000 }).toContain('Dawn Dev');
        await row(page, 'ingot-dev.dawn-theme').locator('.ingot-plugin-uninstall').click();
        await expect(row(page, 'ingot-dev.dawn-theme')).toHaveCount(0, { timeout: 60_000 });
    });
});
