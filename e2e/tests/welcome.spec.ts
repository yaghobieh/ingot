import * as path from 'path';
import { expect, test } from '@playwright/test';
import { openIngot, quickInput } from '../src/app.utils';
import { CONFIG_PROJECT, FIXTURES_DIR, FIXTURE_WORKSPACE, MULTI_ROOT_WORKSPACE } from '../src/e2e.consts';
import { mockOpenVsx } from '../src/fake-open-vsx';

/** A path that does not exist: Theia opens the window without a folder, like a fresh New Window. */
const NO_FOLDER = path.join(FIXTURES_DIR, '.no-folder-open');
const SECOND_PROJECT = path.join(FIXTURES_DIR, 'second-project');

test.describe('IDEA-165 new-window welcome page', () => {
    test('a window without a folder shows the welcome page and the agent chat', async ({ page }) => {
        await mockOpenVsx(page);
        // Four recent workspaces, so "Show More..." has something to expand.
        for (const workspace of [CONFIG_PROJECT, MULTI_ROOT_WORKSPACE, SECOND_PROJECT, FIXTURE_WORKSPACE]) {
            await openIngot(page, workspace);
        }
        await openIngot(page, NO_FOLDER);

        const welcome = page.locator('#ingot-welcome');
        await expect(welcome).toBeVisible();
        await expect(welcome.locator('.ingot-welcome-title')).toHaveText('Ingot');
        await expect(welcome.locator('svg.ingot-mark').first()).toBeAttached();
        await expect(welcome.locator('#ingot-welcome-open')).toHaveText(/Open Folder/);
        await expect(welcome.locator('#ingot-welcome-clone')).toHaveText(/Clone Repository/);

        // Recent workspaces: name plus a shortened path, three until Show More.
        const projects = welcome.locator('#ingot-welcome-workspaces .ingot-welcome-project');
        await expect(projects).toHaveCount(3);
        await expect(projects.first()).toContainText('sample-project');
        await welcome.locator('#ingot-welcome-more').click();
        await expect.poll(() => projects.count()).toBeGreaterThan(3);
        await expect(welcome.locator('#ingot-welcome-more')).toHaveCount(0);

        // Suggested extensions from Open VSX, each with an Install button.
        const extensions = welcome.locator('#ingot-welcome-suggested .ingot-welcome-ext');
        await expect(extensions).toHaveCount(3);
        await expect(extensions.first().locator('.ingot-welcome-install')).toBeVisible();

        // The agent chat is open on the right with the Ingot empty state and the model picker.
        const chat = page.locator('#theia-right-content-panel #ingot-agents');
        await expect(chat).toBeVisible();
        await expect(chat.locator('.ingot-agents-empty-title')).toHaveText('Ingot');
        await expect(chat.locator('.ingot-composer-input')).toHaveAttribute('data-placeholder', 'Ask anything, @ to mention, / for actions');
        await expect(chat.locator('.ingot-composer')).toBeVisible();
        await expect(page.locator('#ingot-welcome')).not.toContainText(/WebStorm|VS Code|JetBrains|IntelliJ|Cursor|Windsurf/);
    });

    test('Clone Repository asks for a URL and rejects odd ones', async ({ page }) => {
        await openIngot(page, NO_FOLDER);
        await page.locator('#ingot-welcome-clone').click();
        await expect(quickInput(page)).toBeVisible();
        await quickInput(page).fill('--upload-pack=evil');
        await expect(page.locator('.quick-input-widget')).toContainText('Enter an https or ssh Git URL.');
        await page.keyboard.press('Escape');
        await expect(quickInput(page)).toBeHidden();
    });

    test('opening a recent workspace from the welcome page loads it', async ({ page }) => {
        await openIngot(page, FIXTURE_WORKSPACE);
        await openIngot(page, NO_FOLDER);
        await page.locator('#ingot-welcome-workspaces .ingot-welcome-project', { hasText: 'sample-project' }).first().click();
        await expect(page.locator('#ingot-tb-project')).toContainText('sample-project', { timeout: 60_000 });
    });
});
