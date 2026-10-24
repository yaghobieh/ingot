import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot, runCommand } from '../src/app.utils';
import { createTempRepo, git, removeTempRepo } from '../src/git-repo';

const quickInput = (page: Page) => page.locator('.quick-input-widget .quick-input-box input');
const quickRows = (page: Page) => page.locator('.quick-input-widget .monaco-list-row');
const branchButton = (page: Page) => page.locator('#ingot-tb-vcs');

test.describe('IDEA-32 Git: branches popup, new branch, log and diff', () => {
    let repo: string;

    test.beforeEach(() => { repo = createTempRepo(); });
    test.afterEach(() => removeTempRepo(repo));

    test('switches and creates branches from the toolbar popup', async ({ page }) => {
        await openIngot(page, repo);
        await expect(branchButton(page)).toContainText('main', { timeout: 15_000 });
        await dismissNotifications(page);

        await actUntilVisible(() => branchButton(page).click(), page.locator('.quick-input-widget').getByText('Git Branches'));
        await expect(quickRows(page).filter({ hasText: '✓ main' })).toBeVisible();
        await page.keyboard.type('login');
        await quickRows(page).filter({ hasText: 'feature/login' }).click();
        await expect(branchButton(page)).toContainText('feature/login', { timeout: 15_000 });
        expect(git(repo, 'branch', '--show-current').trim()).toBe('feature/login');

        await actUntilVisible(() => branchButton(page).click(), page.locator('.quick-input-widget').getByText('Git Branches'));
        await quickRows(page).filter({ hasText: 'New Branch' }).click();
        await expect(page.locator('.quick-input-widget').getByText('New Branch', { exact: true }).first()).toBeVisible();
        await quickInput(page).fill('bad name');
        await expect(page.locator('.quick-input-widget')).toContainText('Not a valid branch name');
        await quickInput(page).fill('topic/log');
        await page.keyboard.press('Enter');
        await expect(branchButton(page)).toContainText('topic/log', { timeout: 15_000 });
        expect(git(repo, 'branch', '--show-current').trim()).toBe('topic/log');
    });

    test('Git Log lists commits, shows changed files and opens a diff', async ({ page }) => {
        await openIngot(page, repo);
        await dismissNotifications(page);
        await runCommand(page, 'Git: Show Log');
        const log = page.locator('#ingot-git-log');
        await expect(log).toBeVisible();
        await expect(log.locator('.ingot-log-row')).toHaveCount(2);
        await expect(log.locator('.ingot-log-row').first()).toContainText('Add sub');
        await expect(log.locator('.ingot-log-row').first()).toContainText('feature/login');

        await log.locator('#ingot-log-filter').fill('initial');
        await expect(log.locator('.ingot-log-row')).toHaveCount(1);
        await log.locator('#ingot-log-filter').fill('');

        await log.locator('.ingot-log-row', { hasText: 'Add sub' }).click();
        const file = log.locator('.ingot-log-file', { hasText: 'src/math.ts' });
        await expect(file).toContainText('M');
        await file.click();
        const diff = page.locator('#theia-main-content-panel .monaco-diff-editor');
        await expect(diff).toBeVisible();
        await expect(diff.locator('.editor.modified .view-lines')).toContainText('export const sub');
        await expect(diff.locator('.editor.original .view-lines')).not.toContainText('export const sub');
    });
});
