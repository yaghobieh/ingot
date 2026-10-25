import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { LEFT_PANEL } from '../src/e2e.consts';

const item = (page: Page, label: string) => page.locator('.lm-Menu .lm-Menu-item', { has: page.locator('.lm-Menu-itemLabel', { hasText: new RegExp(`^${label.replace(/[()]/g, '\\$&')}$`) }) });
/** Escape closes one menu level at a time (submenu first, then its parent). */
const closeMenus = async (page: Page): Promise<void> => {
    await expect(async () => {
        await page.keyboard.press('Escape');
        await expect(page.locator('.lm-Menu')).toHaveCount(0, { timeout: 500 });
    }).toPass({ timeout: 10_000 });
};

/** IDEA-119: right-click a bar to list every panel with a ✓ when showing; click toggles it. */
test.describe('IDEA-119 panel toggles', () => {
    test('left stripe lists all panels and toggles the project tree', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        await page.locator('#ingot-stripe-bottom').click({ button: 'right', position: { x: 10, y: 4 } });
        for (const label of ['Project', 'Search', 'Git', 'Terminal', 'Problems', 'Agents (Chat)', 'MCP Servers', 'Chat on the Right', 'Chat at the Bottom']) {
            await expect(item(page, label)).toBeVisible();
        }
        await expect(item(page, 'Project')).toHaveClass(/lm-mod-toggled/);
        await item(page, 'Project').click();
        await expect(page.locator(LEFT_PANEL)).toBeHidden();

        await page.locator('#ingot-stripe-bottom').click({ button: 'right', position: { x: 10, y: 4 } });
        await expect(item(page, 'Project')).not.toHaveClass(/lm-mod-toggled/);
        await item(page, 'Project').click();
        await expect(page.locator(LEFT_PANEL)).toBeVisible();
    });

    test('right stripe shows Terminal with no ✓, then ✓ once opened; bottom bar empty space has the same menu', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        await page.locator('.ingot-right-stripe').click({ button: 'right', position: { x: 10, y: 200 } });
        await expect(item(page, 'Agents (Chat)')).toHaveClass(/lm-mod-toggled/);
        const terminalShowing = /lm-mod-toggled/.test((await item(page, 'Terminal').getAttribute('class')) ?? '');
        if (terminalShowing) {
            await item(page, 'Terminal').click();
            await page.locator('.ingot-right-stripe').click({ button: 'right', position: { x: 10, y: 200 } });
        }
        await expect(item(page, 'Terminal')).not.toHaveClass(/lm-mod-toggled/);
        await item(page, 'Terminal').click();
        await expect(page.locator('#theia-bottom-content-panel .lm-TabBar-tab', { hasText: /Terminal|zsh|bash/ }).first()).toBeVisible();

        // Right-click the empty part of the bottom tab bar.
        const bar = page.locator('#theia-bottom-content-panel .lm-TabBar').first();
        const box = (await bar.boundingBox())!;
        await page.mouse.click(box.x + box.width - 60, box.y + box.height / 2, { button: 'right' });
        await expect(item(page, 'Terminal')).toHaveClass(/lm-mod-toggled/);
        await item(page, 'Terminal').click();
        await expect(page.locator('#theia-bottom-content-panel')).toBeHidden();
    });

    test('a bottom tab keeps its own menu with a Tool Windows submenu', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        await page.locator('.ingot-right-stripe').click({ button: 'right', position: { x: 10, y: 200 } });
        await item(page, 'Problems').click();
        const tab = page.locator('#theia-bottom-content-panel .lm-TabBar-tab', { hasText: 'Problems' });
        await expect(tab).toBeVisible();
        await tab.click({ button: 'right' });
        await expect(item(page, 'Tool Windows')).toBeVisible();
        await item(page, 'Tool Windows').hover();
        await expect(item(page, 'Problems')).toHaveClass(/lm-mod-toggled/);
        await closeMenus(page);
    });
});
