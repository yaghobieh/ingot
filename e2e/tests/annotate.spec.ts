import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';

/** IDEA-83: Annotate with Git Blame from the line-number gutter, on a real throwaway Git repository. */
const commit = (cwd: string, author: string, date: string, message: string): void => {
    const env = { ...process.env, GIT_AUTHOR_NAME: author, GIT_AUTHOR_EMAIL: 'dev@ingot.dev', GIT_AUTHOR_DATE: date, GIT_COMMITTER_NAME: author, GIT_COMMITTER_EMAIL: 'dev@ingot.dev', GIT_COMMITTER_DATE: date };
    execFileSync('git', ['add', '.'], { cwd, env });
    execFileSync('git', ['commit', '-q', '-m', message], { cwd, env });
};
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });

const makeRepo = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-annotate-')));
    git(dir, 'init', '-q', '-b', 'main');
    fs.mkdirSync(path.join(dir, 'src'));
    const file = path.join(dir, 'src', 'cart.ts');
    fs.writeFileSync(file, 'export function addItem(id: string) {\n    return id;\n}\n');
    commit(dir, 'Ada Lovelace', '2025-01-02T10:00:00', 'Add cart');
    fs.writeFileSync(file, 'export function addItem(id: string) {\n    return id.trim();\n}\n');
    commit(dir, 'Grace Hopper', '2026-10-01T10:00:00', 'Trim item ids');
    return dir;
};

const editor = (page: Page) => page.locator('.monaco-editor:not(.monaco-diff-editor .monaco-editor)').first();
const lineNumber = (page: Page, n: number) => editor(page).locator('.margin-view-overlays .line-numbers', { hasText: new RegExp(`(^|\\s)${n}$`) }).first();

const openCart = async (page: Page): Promise<void> => {
    await expect(async () => {
        await page.keyboard.press('Escape');
        await page.keyboard.press('Control+p');
        await expect(page.locator('.quick-input-widget input')).toBeVisible({ timeout: 2_000 });
        await page.locator('.quick-input-widget input').fill('cart.ts');
        await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'cart.ts' }).first().click({ timeout: 3_000 });
        await expect(editor(page).locator('.view-lines')).toContainText('addItem', { timeout: 3_000 });
    }).toPass({ timeout: 40_000 });
};

const gutterMenu = async (page: Page, n: number, label: string): Promise<void> => {
    await expect(async () => {
        if (await page.locator('.lm-Menu').first().isVisible()) {
            await page.keyboard.press('Escape');
        }
        await lineNumber(page, n).click({ button: 'right' });
        await expect(page.locator('.lm-Menu').first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
    await page.locator('.lm-Menu').first().locator('.lm-Menu-item', { hasText: label }).first().click();
};

test.describe('IDEA-83 Annotate with Git Blame', () => {
    test.use({ permissions: ['clipboard-read', 'clipboard-write'] });
    let repo: string;
    test.beforeEach(async ({ page }) => {
        repo = makeRepo();
        await openIngot(page, repo);
        await dismissNotifications(page);
        await openCart(page);
    });
    test.afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

    test('clicking the gutter annotates; hover shows the commit; clicking opens details and line history', async ({ page }) => {
        await lineNumber(page, 1).click();
        await expect(editor(page)).toHaveClass(/ingot-annotated/);
        await expect(lineNumber(page, 1)).toContainText('2025-01-02 Ada Lovelace');
        await expect(lineNumber(page, 2)).toContainText('2026-10-01 Grace Hopper');
        // Focusing the text keeps the annotation styling (Monaco rewrites the editor node's classes on focus).
        await editor(page).locator('.view-lines').click();
        await expect(editor(page)).toHaveClass(/ingot-annotated/);
        await expect(lineNumber(page, 1)).toHaveCSS('text-align', 'left');
        // Newest commit gets the strongest age shade, the oldest none.
        await expect(lineNumber(page, 2)).toHaveClass(/ingot-annotation-age-0/);
        await expect(lineNumber(page, 1)).toHaveClass(/ingot-annotation-age-4/);

        await lineNumber(page, 2).hover();
        await expect(page.locator('.ingot-annotation-hover')).toContainText('Trim item ids', { timeout: 5_000 });
        await expect(page.locator('.ingot-annotation-hover')).toContainText('Grace Hopper');
        const head = git(repo, 'rev-parse', 'HEAD').trim();
        await expect(page.locator('.ingot-annotation-hover .ingot-annotation-hash')).toHaveText(head.slice(0, 8));

        // Clicking an annotation: commit details + the line's history back to the first commit.
        await lineNumber(page, 2).click();
        const dialog = page.locator('.ingot-annotation-dialog');
        await expect(dialog).toBeVisible();
        await expect(dialog.locator('#ingot-annotation-commit')).toContainText('Trim item ids');
        await expect(dialog.locator('#ingot-annotation-commit')).toContainText('Grace Hopper');
        const rows = dialog.locator('.ingot-annotation-history-row');
        await expect(rows).toHaveCount(2);
        await expect(rows.last()).toContainText('Add cart');
        await expect(rows.last()).toContainText('introduced');
        await rows.last().click();
        await expect(dialog.locator('#ingot-annotation-commit')).toContainText('Ada Lovelace');
        await rows.first().click();
        await dialog.locator('#ingot-annotation-log').click();
        await expect(dialog).toBeHidden();
        await expect(page.locator(`.ingot-log-row.selected[data-hash="${head}"]`)).toBeVisible({ timeout: 10_000 });

        // Right-click > Close Annotations restores plain line numbers.
        await gutterMenu(page, 1, 'Close Annotations');
        await expect(editor(page)).not.toHaveClass(/ingot-annotated/);
        await expect(lineNumber(page, 1)).not.toContainText('Ada');
    });

    test('right-click annotate, previous revision, and uncommitted lines', async ({ page }) => {
        await gutterMenu(page, 2, 'Annotate with Git Blame');
        await expect(lineNumber(page, 2)).toContainText('Grace Hopper');
        await gutterMenu(page, 2, 'Annotate Previous Revision');
        // The revision before "Trim item ids": every line is Ada's.
        await expect(lineNumber(page, 2)).toContainText('Ada Lovelace');
        await expect(editor(page).locator('.line-numbers', { hasText: 'Grace' })).toHaveCount(0);
        await gutterMenu(page, 2, 'Close Annotations');

        // A saved, uncommitted edit is annotated as today's change.
        fs.appendFileSync(path.join(repo, 'src', 'cart.ts'), 'export const LIMIT = 9;\n');
        await expect(editor(page).locator('.view-lines')).toContainText('LIMIT', { timeout: 10_000 });
        await lineNumber(page, 1).click();
        await expect(lineNumber(page, 4)).toContainText('Today');
        await expect(lineNumber(page, 4)).toHaveClass(/ingot-annotation-age-new/);
    });
});
