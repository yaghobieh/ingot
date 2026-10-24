import { expect, test, type Page } from '@playwright/test';
import { actUntilHidden, actUntilVisible, openIngot, runCommand } from '../src/app.utils';
import { EXPLORER_TAB, LEFT_PANEL, TOOL_WINDOW_MOD } from '../src/e2e.consts';

const explorerVisible = (page: Page) => page.locator(`${LEFT_PANEL} #explorer-view-container`);

test.describe('IDEA-13/14 main toolbar and tool windows', () => {
    test('renders the JetBrains-style main toolbar with project and VCS widgets', async ({ page }) => {
        await openIngot(page);
        const toolbar = page.locator('#ingot-main-toolbar');
        await expect(toolbar).toBeVisible();
        await expect(toolbar.locator('.ingot-tb-logo')).toBeVisible();
        await expect(page.locator('#ingot-tb-project')).toContainText('sample-project');
        for (const id of ['vcs', 'run-config', 'run', 'debug', 'stop', 'search', 'plugins', 'settings']) {
            await expect(page.locator(`#ingot-tb-${id}`)).toBeVisible();
        }
    });

    test('opens the Project tool window by default and toggles it with Cmd/Alt+1', async ({ page }) => {
        await openIngot(page);
        await expect(explorerVisible(page)).toBeVisible();
        // Like IntelliJ: the shortcut focuses the tool window, pressing it again while focused hides it.
        await actUntilHidden(() => page.keyboard.press(`${TOOL_WINDOW_MOD}+1`), explorerVisible(page));
        await page.keyboard.press(`${TOOL_WINDOW_MOD}+1`);
        await expect(explorerVisible(page)).toBeVisible();
        await expect(page.locator(EXPLORER_TAB)).toBeVisible();
    });

    test('opens the Terminal with Alt+F12 and Problems with Cmd/Alt+6', async ({ page }) => {
        await openIngot(page);
        await actUntilVisible(() => page.keyboard.press('Alt+F12'), page.locator('#theia-bottom-content-panel [id^="terminal-"]').first());
        await page.keyboard.press(`${TOOL_WINDOW_MOD}+6`);
        await expect(page.locator('#problems')).toBeVisible();
    });

    test('Hide All Tool Windows collapses and restores the side panels', async ({ page }) => {
        await openIngot(page);
        await expect(explorerVisible(page)).toBeVisible();
        await runCommand(page, 'Hide All Tool Windows');
        await expect(explorerVisible(page)).toBeHidden();
        await runCommand(page, 'Hide All Tool Windows');
        await expect(explorerVisible(page)).toBeVisible();
    });

    test('toolbar Search button opens Go to File', async ({ page }) => {
        await openIngot(page);
        await actUntilVisible(() => page.locator('#ingot-tb-search').click(), page.locator('.quick-input-widget'));
    });
});

test.describe('IDEA-15/16 welcome screen, brand and themes', () => {
    test('shows the Welcome screen with recent projects and actions', async ({ page }) => {
        await openIngot(page);
        await runCommand(page, 'Welcome to Ingot');
        const welcome = page.locator('#ingot-welcome');
        await expect(welcome).toBeVisible();
        await expect(welcome.locator('#ingot-welcome-open')).toBeVisible();
        await expect(welcome.locator('#ingot-welcome-clone')).toBeVisible();
        await welcome.locator('#ingot-welcome-tab-plugins').click();
        await expect(welcome.locator('#ingot-welcome-open-plugins')).toBeVisible();
    });

    test('switches between Ingot Light and Ingot Dark from Customize', async ({ page }) => {
        await openIngot(page);
        await runCommand(page, 'Welcome to Ingot');
        const welcome = page.locator('#ingot-welcome');
        await welcome.locator('#ingot-welcome-tab-customize').click();
        await welcome.locator('#ingot-theme-ingot-dark').click();
        await expect(page.locator('body')).toHaveClass(/theia-dark/);
        await expect(welcome.locator('#ingot-theme-ingot-dark')).toHaveClass(/active/);
        await welcome.locator('#ingot-theme-ingot-light').click();
        await expect(page.locator('body')).toHaveClass(/theia-light/);
    });
});
