import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { openIngot } from '../src/app.utils';
import { FIXTURE_WORKSPACE, MULTI_ROOT_WORKSPACE } from '../src/e2e.consts';

const SAVED_WORKSPACE = path.join(FIXTURE_WORKSPACE, 'saved-by-e2e.ingot-workspace');
const projectButton = (page: Page) => page.locator('#ingot-tb-project');
const popup = (page: Page) => page.locator('#ingot-project-popup');
const treeRoot = (page: Page, name: string) => page.locator('#files .theia-TreeNode', { hasText: name }).first();

test.describe('IDEA-51 workspaces (.ingot-workspace / .code-workspace)', () => {
    test.afterEach(() => fs.rmSync(SAVED_WORKSPACE, { force: true }));

    test('opens a multi-root .ingot-workspace with both roots and names the project after the file', async ({ page }) => {
        await openIngot(page, MULTI_ROOT_WORKSPACE);
        await expect(projectButton(page)).toContainText('multi-root');
        await expect(treeRoot(page, 'sample-project')).toBeVisible({ timeout: 30_000 });
        await expect(treeRoot(page, 'second-project')).toBeVisible();
    });

    test('project ▾ lists recent projects and workspaces and switches between them', async ({ page }) => {
        await openIngot(page, MULTI_ROOT_WORKSPACE);
        await expect(projectButton(page)).toContainText('multi-root');
        await openIngot(page, FIXTURE_WORKSPACE);
        await expect(projectButton(page)).toContainText('sample-project');

        await projectButton(page).click();
        await expect(popup(page)).toBeVisible();
        const recent = popup(page).locator('.ingot-project-popup-recent', { hasText: 'multi-root' });
        await expect(recent).toContainText('workspace');
        await expect(popup(page).locator('#ingot-project-action-open-workspace')).toBeVisible();
        await expect(popup(page).locator('#ingot-project-action-save-workspace')).toBeVisible();

        await page.keyboard.press('Escape');
        await expect(popup(page)).toBeHidden();

        await projectButton(page).click();
        await recent.click();
        await expect(projectButton(page)).toContainText('multi-root', { timeout: 30_000 });
        await expect(treeRoot(page, 'second-project')).toBeVisible({ timeout: 30_000 });
    });

    test('Welcome shows workspaces among recent projects and offers Open Workspace', async ({ page }) => {
        await openIngot(page, MULTI_ROOT_WORKSPACE);
        await openIngot(page, FIXTURE_WORKSPACE);
        await page.keyboard.press('F1');
        await page.getByRole('textbox', { name: 'Type to narrow down results.' }).fill('>Welcome to Ingot');
        await page.getByRole('option', { name: /Welcome to Ingot/ }).first().click();
        await page.locator('#ingot-welcome-tab-projects').click();
        await expect(page.locator('#ingot-welcome-open-workspace')).toBeVisible();
        await expect(page.locator('.ingot-welcome-project', { hasText: 'multi-root' })).toContainText('workspace');
    });

    test('saves the open project as an .ingot-workspace from the project ▾ popup', async ({ page }) => {
        await openIngot(page, FIXTURE_WORKSPACE);
        await projectButton(page).click();
        await popup(page).locator('#ingot-project-action-save-workspace').click();
        const dialog = page.locator('.dialogOverlay');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('select').last()).toContainText('Ingot workspace');
        await dialog.locator('.theia-TreeNode', { hasText: 'sample-project' }).first().click();
        const fileName = dialog.locator('input.theia-input').last();
        await fileName.fill('saved-by-e2e.ingot-workspace');
        await fileName.press('End'); // the dialog validates the name on keyup
        await dialog.getByRole('button', { name: 'Save' }).click();
        await expect(projectButton(page)).toContainText('saved-by-e2e', { timeout: 30_000 });
        await expect.poll(() => fs.existsSync(SAVED_WORKSPACE)).toBe(true);
        expect(JSON.parse(fs.readFileSync(SAVED_WORKSPACE, 'utf8')).folders).toHaveLength(1);
    });
});
