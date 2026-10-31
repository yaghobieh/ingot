import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, openIngot, runCommand } from '../src/app.utils';

const PORTS_LABEL = 'View: Toggle Ports';

const terminalPanel = (page: Page) => page.locator('#theia-bottom-content-panel [id^="terminal-"]').first();
const portsPanel = (page: Page) => page.locator('#ingot-ports');
const randomPort = (): number => 47_000 + Math.floor(Math.random() * 2_000);

test.describe('IDEA-13/14 Ingot UI shell', () => {
    test('keeps the bottom panel closed and docks a Terminal there with ⌥F12', async ({ page }) => {
        await openIngot(page);
        await expect(terminalPanel(page)).toBeHidden();
        await actUntilVisible(() => page.keyboard.press('Alt+F12'), terminalPanel(page));
    });

    test('names the window Ingot and the file tree after the project', async ({ page }) => {
        await openIngot(page);
        await expect(page).toHaveTitle(/^Ingot/);
        // IDEA-93: just the project name, no 'Project:' prefix.
        await expect(page.locator('#theia-left-content-panel .theia-sidepanel-title')).toHaveText('sample-project');
        await expect(page.locator('#theia-left-content-panel .theia-sidepanel-title')).not.toHaveText(/explorer/i);
    });

    test('shows a thin stripe with Project, Search and Git, no Terminal, and no blank icons', async ({ page }) => {
        await openIngot(page);
        for (const id of ['explorer-view-container', 'search-view-container', 'scm-view-container']) {
            await expect(page.locator(`#shell-tab-${id}`)).toBeVisible();
        }
        await expect(page.locator('#ingot-stripe-terminal')).toHaveCount(0);
        for (const id of ['debug', 'vsx-extensions-view-container']) {
            await expect(page.locator(`#shell-tab-${id}`)).toBeHidden();
        }
        // Commit and Threads dock in the side bar too, so their tabs are checked with the rest.
        await runCommand(page, 'View: Toggle Local Changes');
        await expect(page.locator('#shell-tab-ingot-local-changes')).toBeVisible();
        await runCommand(page, 'View: Toggle Threads');
        await expect(page.locator('#shell-tab-ingot-threads')).toBeVisible();
        // A tab icon with no mask, no background image and no glyph renders as a plain square.
        const blankIcons = await page.locator('#theia-left-content-panel .lm-TabBar.theia-app-sides .lm-TabBar-tab .lm-TabBar-tabIcon').evaluateAll(icons => icons
            .filter(icon => {
                const style = getComputedStyle(icon);
                const glyph = getComputedStyle(icon, '::before').content;
                return style.maskImage === 'none' && style.backgroundImage === 'none' && (glyph === 'none' || glyph === 'normal');
            })
            .map(icon => icon.closest('.lm-TabBar-tab')?.id));
        expect(blankIcons).toEqual([]);
        await page.locator('#shell-tab-search-view-container').click();
        await expect(page.locator('#search-view-container')).toBeVisible();
    });

    test('opens the main menu from the hamburger and shows Agents on the right', async ({ page }) => {
        await openIngot(page);
        await page.locator('#ingot-tb-menu').click();
        await expect(page.locator('.lm-Menu').first()).toBeVisible();
        await expect(page.locator('.lm-Menu').first()).toContainText('File');
        await page.keyboard.press('Escape');
        await expect(page.locator('#ingot-agents')).toBeVisible();
        // IDEA-61: the right edge shows Ingot's tool window stripe instead of Theia's side tabs.
        await expect(page.locator('#theia-right-content-panel .theia-app-sidebar-container > .lm-TabBar')).toBeHidden();
        await expect(page.locator('#ingot-right-stripe')).toBeVisible();
    });

    test('editor breadcrumbs, status bar index state and caret position', async ({ page }) => {
        await openIngot(page);
        await page.locator('#explorer-view-container .theia-TreeNode', { hasText: 'src' }).first().click();
        await page.locator('#explorer-view-container .theia-TreeNode', { hasText: 'math.ts' }).first().dblclick();
        await expect(page.locator('.theia-breadcrumbs').first()).toContainText('math.ts');
        await expect(page.locator('#theia-statusBar')).toContainText('Index ready');
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
        await runCommand(page, PORTS_LABEL);
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
