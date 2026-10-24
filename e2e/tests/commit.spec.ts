import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';

/** IDEA-74: Local Changes (Ctrl+K), diff viewer with chunk checkboxes, Commit and Push / Push dialog (Ctrl+Shift+K). */
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });
const A_BASE = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`).join('\n') + '\n';
const A_WORK = A_BASE.replace('line 2\n', 'line 2 changed\n').replace('line 28\n', 'line 28 changed\n');

const makeRepo = (): { repo: string; remote: string } => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-commit-')));
    const remote = path.join(base, 'remote.git');
    const repo = path.join(base, 'shop');
    git(base, 'init', '-q', '--bare', '-b', 'main', remote);
    fs.mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'e2e@ingot.dev');
    git(repo, 'config', 'user.name', 'E2E Bot');
    git(repo, 'remote', 'add', 'origin', `file://${remote}`);
    fs.writeFileSync(path.join(repo, 'a.ts'), A_BASE);
    fs.writeFileSync(path.join(repo, 'b.ts'), 'export const b = 1;\n');
    fs.writeFileSync(path.join(repo, 'del.ts'), 'gone\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'Init');
    git(repo, 'push', '-q', '-u', 'origin', 'main');
    fs.writeFileSync(path.join(repo, 'a.ts'), A_WORK);
    fs.writeFileSync(path.join(repo, 'b.ts'), 'export const b = 2;\n');
    fs.rmSync(path.join(repo, 'del.ts'));
    fs.writeFileSync(path.join(repo, 'new.md'), '# new\n');
    return { repo, remote: base };
};

const row = (page: Page, file: string) => page.locator(`.ingot-lc-file[data-path="${file}"]`);
const openCommit = async (page: Page): Promise<void> => {
    await actUntilVisible(() => page.keyboard.press('Control+k'), page.locator('#ingot-commit-message'));
    await expect(row(page, 'a.ts')).toBeVisible({ timeout: 15_000 });
};

test.describe('IDEA-74 commit tool window', () => {
    let repo: string;
    let base: string;
    test.beforeEach(() => { ({ repo, remote: base } = makeRepo()); });
    test.afterEach(() => fs.rmSync(base, { recursive: true, force: true }));

    test('lists changes by changelist and commits only the checked files', async ({ page }) => {
        await openIngot(page, repo);
        await dismissNotifications(page);
        await openCommit(page);

        await expect(page.locator('.ingot-lc-group-row', { hasText: 'Default Changelist' })).toContainText('3 files');
        await expect(page.locator('.ingot-lc-group-row', { hasText: 'Unversioned Files' })).toContainText('1 file');
        await expect(row(page, 'a.ts').locator('.ingot-lc-name')).toHaveClass(/ingot-lc-modified/);
        await expect(row(page, 'del.ts').locator('.ingot-lc-name')).toHaveClass(/ingot-lc-deleted/);
        await expect(row(page, 'new.md').locator('.ingot-lc-name')).toHaveClass(/ingot-lc-untracked/);
        await expect(page.locator('#ingot-commit-count')).toHaveText('3 modified');

        await row(page, 'b.ts').locator('input[type=checkbox]').uncheck();
        await expect(page.locator('#ingot-commit-button')).toBeDisabled();
        await page.locator('#ingot-commit-message').fill('Update a, drop del');
        await page.locator('#ingot-commit-button').click();
        await expect.poll(() => git(repo, 'log', '-1', '--format=%s').trim()).toBe('Update a, drop del');
        expect(git(repo, 'show', '--name-only', '--format=', 'HEAD').trim().split('\n').sort()).toEqual(['a.ts', 'del.ts']);
        await expect(row(page, 'a.ts')).toHaveCount(0);
        await expect(row(page, 'b.ts')).toBeVisible();

        // Context menu: Rollback… restores b.ts after confirmation.
        await row(page, 'b.ts').click({ button: 'right' });
        await page.locator('.lm-Menu .lm-Menu-item', { hasText: 'Rollback…' }).click();
        await page.locator('.dialogBlock').getByRole('button', { name: 'Rollback' }).click();
        await expect.poll(() => fs.readFileSync(path.join(repo, 'b.ts'), 'utf8')).toBe('export const b = 1;\n');
    });

    test('diff viewer chunk checkboxes make a partial commit', async ({ page }) => {
        await openIngot(page, repo);
        await dismissNotifications(page);
        await openCommit(page);

        await row(page, 'a.ts').dblclick();
        const diff = page.locator('.ingot-diff');
        await expect(diff.locator('.ingot-diff-header-right')).toHaveText('Your version');
        await expect(diff.locator('#ingot-diff-summary')).toHaveText('2 changes · 2 included');
        await expect(diff.locator('.ingot-hunk-check')).toHaveCount(2, { timeout: 15_000 });
        await diff.locator('#ingot-diff-next-change').click();
        await diff.locator('.ingot-hunk-check').nth(1).click();
        await expect(diff.locator('#ingot-diff-summary')).toHaveText('2 changes · 1 included');
        await expect(row(page, 'a.ts').locator('input[type=checkbox]')).toHaveJSProperty('indeterminate', true);
        await diff.locator('#ingot-diff-viewer').selectOption('unified');

        for (const f of ['b.ts', 'del.ts']) {
            await row(page, f).locator('input[type=checkbox]').uncheck();
        }
        await page.locator('#ingot-commit-message').fill('Only the first chunk');
        await page.locator('#ingot-commit-button').click();
        await expect.poll(() => git(repo, 'log', '-1', '--format=%s').trim()).toBe('Only the first chunk');
        const committed = git(repo, 'show', 'HEAD:a.ts');
        expect(committed).toContain('line 2 changed');
        expect(committed).not.toContain('line 28 changed');
        expect(fs.readFileSync(path.join(repo, 'a.ts'), 'utf8')).toContain('line 28 changed');
    });

    test('Commit and Push opens the Push dialog with a New target branch, then pushes', async ({ page }) => {
        git(repo, 'checkout', '-q', '-b', 'feature/qty');
        await openIngot(page, repo);
        await dismissNotifications(page);
        await openCommit(page);
        await page.locator('#ingot-commit-message').fill('Ship it');
        await page.locator('#ingot-commit-menu').click();
        await page.locator('#ingot-commit-and-push').click();

        const dialog = page.locator('.ingot-push-dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('.dialogTitle')).toContainText('Push Commits to shop');
        await expect(dialog.locator('#ingot-push-branch')).toContainText('feature/qty');
        await expect(dialog.locator('#ingot-push-new')).toBeVisible();
        await expect(dialog.locator('.ingot-push-commit')).toHaveCount(1);
        await expect(dialog.locator('.ingot-push-commit')).toContainText('Ship it');
        await expect(dialog.locator('.ingot-push-file')).toHaveCount(3); // unversioned new.md is unchecked by default

        // Edit the target branch name.
        await dialog.locator('#ingot-push-target').click();
        await dialog.locator('#ingot-push-target-input').fill('feature/qty-remote');
        await dialog.locator('#ingot-push-target-input').press('Enter');
        await expect(dialog.locator('#ingot-push-target')).toHaveText('feature/qty-remote');
        await dialog.locator('#ingot-push-button').click();
        await expect.poll(() => git(path.join(base, 'remote.git'), 'branch', '--list').trim()).toContain('feature/qty-remote');

        // Ctrl+Shift+K opens the Push dialog: nothing left to push.
        await page.keyboard.press('Control+Shift+k');
        await expect(dialog.locator('.ingot-lc-empty', { hasText: 'Nothing to push.' })).toBeVisible();
        await dialog.locator('#ingot-push-cancel').click();
    });

    test('IDEA-78: revert arrows put a chunk back to HEAD (undoable), × excludes a chunk, Revert File restores it', async ({ page }) => {
        await openIngot(page, repo);
        await dismissNotifications(page);
        await openCommit(page);
        await row(page, 'a.ts').dblclick();
        const diff = page.locator('.ingot-diff');
        await expect(diff.locator('#ingot-diff-summary')).toHaveText('2 changes · 2 included');
        await expect(diff.locator('.ingot-hunk-revert')).toHaveCount(2, { timeout: 15_000 });
        await expect(diff.locator('.ingot-hunk-ignore')).toHaveCount(2);

        // × on the HEAD side excludes the second chunk without changing the file; click again to include.
        await diff.locator('.ingot-hunk-ignore').nth(1).click();
        await expect(diff.locator('#ingot-diff-summary')).toHaveText('2 changes · 1 included');
        await expect(diff.locator('.ingot-hunk-ignored').first()).toBeVisible();
        expect(fs.readFileSync(path.join(repo, 'a.ts'), 'utf8')).toBe(A_WORK);
        await diff.locator('.ingot-hunk-ignore').nth(1).click();
        await expect(diff.locator('#ingot-diff-summary')).toHaveText('2 changes · 2 included');

        // ‹ reverts the first chunk to HEAD (saved by auto-save); undo brings it back.
        await diff.locator('.ingot-hunk-revert').first().click();
        await expect(diff.locator('#ingot-diff-summary')).toHaveText('1 change · 1 included');
        await expect.poll(() => fs.readFileSync(path.join(repo, 'a.ts'), 'utf8'), { timeout: 10_000 }).toBe(A_WORK.replace('line 2 changed\n', 'line 2\n'));
        await diff.locator('.editor.modified .view-lines').click();
        await page.keyboard.press('Control+z');
        await expect(diff.locator('#ingot-diff-summary')).toHaveText('2 changes · 2 included');

        // Toolbar: revert the chunk at the caret, then Revert File… restores HEAD after confirmation.
        await diff.locator('#ingot-diff-revert-chunk').click();
        await expect(diff.locator('#ingot-diff-summary')).toHaveText('1 change · 1 included');
        await diff.locator('#ingot-diff-revert-file').click();
        await page.locator('.dialogBlock').getByRole('button', { name: 'Rollback' }).click();
        await expect.poll(() => fs.readFileSync(path.join(repo, 'a.ts'), 'utf8'), { timeout: 10_000 }).toBe(A_BASE);
    });
});
