import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { openIngot } from '../src/app.utils';
import { FIXTURES_DIR, FIXTURE_WORKSPACE, GROUP_FIXTURE } from '../src/e2e.consts';

const NEW_GROUP = path.join(FIXTURES_DIR, 'e2e-group.ingot-group');
const tab = (page: Page, name: string) => page.locator(`#ingot-project-tab-${name}`);
const tree = (page: Page) => page.locator('#files');
const editorTab = (page: Page, label: string) => page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: label });
const terminalTabs = (page: Page) => page.locator('#theia-bottom-content-panel .lm-TabBar-tab.terminal-tab, #theia-bottom-content-panel .lm-TabBar-tab[id*="terminal"]');

test.describe('IDEA-52 project groups', () => {
    test.afterEach(() => fs.rmSync(NEW_GROUP, { force: true }));

    test('opens a group as project tabs and swaps tree, editors, terminals and agents per project', async ({ page }) => {
        await openIngot(page, GROUP_FIXTURE);
        await expect(page.locator('#ingot-tb-project')).toContainText('fullstack');
        await expect(tab(page, 'sample-project')).toHaveClass(/active/, { timeout: 30_000 });
        await expect(tab(page, 'second-project')).toBeVisible();

        // Project A: tree shows only its root; open a file; start an agent.
        await expect(tree(page).getByText('sample-project', { exact: true })).toBeVisible();
        await expect(tree(page).getByText('second-project', { exact: true })).toHaveCount(0);
        await tree(page).getByText('package.json', { exact: true }).dblclick();
        await expect(editorTab(page, 'package.json')).toBeVisible();
        await page.locator('#ingot-agents-new').click();
        await page.locator('#ingot-composer-input').fill('Agent in sample-project');
        await page.keyboard.press('Enter');
        await expect(page.locator('.ingot-agent-item', { hasText: 'Agent in sample-project' })).toBeVisible();
        const terminalsInA = await terminalTabs(page).count();

        // Switch to project B: everything swaps.
        await tab(page, 'second-project').click();
        await expect(tab(page, 'second-project')).toHaveClass(/active/);
        await expect(tree(page).getByText('second-project', { exact: true })).toBeVisible();
        await expect(tree(page).getByText('sample-project', { exact: true })).toHaveCount(0);
        await expect(editorTab(page, 'package.json')).toHaveCount(0);
        await expect(page.locator('.ingot-agent-item', { hasText: 'Agent in sample-project' })).toHaveCount(0);
        await expect(terminalTabs(page)).toHaveCount(1);

        // And back with the IntelliJ "Previous Project Window" shortcut.
        await page.locator('#files').click();
        await page.keyboard.press('Control+Alt+BracketLeft');
        await expect(tab(page, 'sample-project')).toHaveClass(/active/);
        await expect(editorTab(page, 'package.json')).toBeVisible();
        await expect(page.locator('.ingot-agent-item', { hasText: 'Agent in sample-project' })).toBeVisible();
        await expect(terminalTabs(page)).toHaveCount(terminalsInA);
    });

    test('creates a new group from the project ▾ popup and lists it as a recent group', async ({ page }) => {
        await openIngot(page, FIXTURE_WORKSPACE);
        await page.locator('#ingot-tb-project').click();
        await page.locator('#ingot-project-action-new-group').click();
        const nameInput = page.locator('.quick-input-widget input');
        await nameInput.fill('e2e-group');
        await nameInput.press('Enter');
        await expect(page.locator('#ingot-tb-project')).toContainText('e2e-group', { timeout: 30_000 });
        await expect(tab(page, 'sample-project')).toHaveClass(/active/);
        expect(JSON.parse(fs.readFileSync(NEW_GROUP, 'utf8')).folders).toEqual([{ path: 'sample-project' }]);

        await openIngot(page, FIXTURE_WORKSPACE);
        await page.locator('#ingot-tb-project').click();
        await expect(page.locator('.ingot-project-popup-recent', { hasText: 'e2e-group' })).toContainText('group');
    });
});
