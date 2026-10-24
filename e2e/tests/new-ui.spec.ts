import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, openIngot } from '../src/app.utils';

const terminalPanel = (page: Page) => page.locator('#theia-bottom-content-panel [id^="terminal-"]').first();
const portsPanel = (page: Page) => page.locator('#ingot-ports');
const randomPort = (): number => 47_000 + Math.floor(Math.random() * 2_000);

test.describe('IDEA-13/14 JetBrains New UI shell', () => {
    test('docks a Terminal at the bottom by default', async ({ page }) => {
        await openIngot(page);
        await expect(terminalPanel(page)).toBeVisible({ timeout: 30_000 });
    });

    test('shows the bottom tool window stripe and toggles tool windows from it', async ({ page }) => {
        await openIngot(page);
        for (const id of ['terminal', 'run', 'problems', 'ports', 'git']) {
            await expect(page.locator(`#ingot-stripe-${id}`)).toBeVisible();
        }
        await actUntilVisible(() => page.locator('#ingot-stripe-problems').click(), page.locator('#problems'));
        await page.locator('#ingot-stripe-ports').click();
        await expect(portsPanel(page)).toBeVisible();
        await expect(page.locator('#ingot-stripe-ports')).toHaveClass(/selected/);
    });

    test('opens the main menu from the hamburger and shows AI Chat on the right stripe', async ({ page }) => {
        await openIngot(page);
        await page.locator('#ingot-tb-menu').click();
        await expect(page.locator('.lm-Menu').first()).toBeVisible();
        await expect(page.locator('.lm-Menu').first()).toContainText('File');
        await page.keyboard.press('Escape');
        await page.locator('.lm-TabBar.theia-app-sides [id^="shell-tab-ingot-ai-chat"]').first().click();
        await expect(page.locator('#ingot-ai-chat')).toContainText('Ingot AI');
    });

    test('status bar shows JetBrains breadcrumbs and caret position', async ({ page }) => {
        await openIngot(page);
        await page.locator('#explorer-view-container .theia-TreeNode', { hasText: 'src' }).first().click();
        await page.locator('#explorer-view-container .theia-TreeNode', { hasText: 'math.ts' }).first().dblclick();
        await expect(page.locator('#theia-statusBar')).toContainText('sample-project › src › math.ts');
        await expect(page.locator('#theia-statusBar [id$="editor-status-cursor-position"]')).toHaveText('1:1');
    });
});

test.describe('IDEA-24 terminal and Ports tool window', () => {
    test('runs a server in the terminal, finds it in Ports, opens it and stops it', async ({ page, request }) => {
        const port = randomPort();
        await openIngot(page);

        // Run a real command in the integrated terminal.
        await actUntilVisible(() => page.keyboard.press('Alt+F12'), terminalPanel(page));
        await terminalPanel(page).click();
        await page.keyboard.type(`node -e "require('http').createServer((q,s)=>s.end('ingot-e2e-ok')).listen(${port},'127.0.0.1')"`);
        await page.keyboard.press('Enter');

        // The command's output is served on the port.
        await expect(async () => {
            const response = await request.get(`http://127.0.0.1:${port}`);
            expect(await response.text()).toBe('ingot-e2e-ok');
        }).toPass({ timeout: 20_000 });

        // Ports lists it with its process.
        await page.locator('#ingot-stripe-ports').click();
        const row = portsPanel(page).locator(`tr[data-port="${port}"]`);
        await expect(row).toBeVisible({ timeout: 15_000 });
        await expect(row).toContainText('node');

        // Open in browser.
        const popup = page.waitForEvent('popup');
        await row.getByRole('button', { name: `Open port ${port} in browser` }).click();
        await expect((await popup)).toHaveURL(new RegExp(`127\\.0\\.0\\.1:${port}`));

        // Stop it.
        await row.getByRole('button', { name: `Stop process on port ${port}` }).click();
        await page.locator('.dialogBlock').getByRole('button', { name: 'Stop' }).click();
        await expect(row).toBeHidden({ timeout: 15_000 });
        await expect(async () => {
            await expect(request.get(`http://127.0.0.1:${port}`, { timeout: 1_000 })).rejects.toThrow();
        }).toPass({ timeout: 10_000 });
    });
});
