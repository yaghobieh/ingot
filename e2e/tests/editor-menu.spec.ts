import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';

/** IDEA-56: the editor right-click menu, clicked through on a real throwaway Git repository. */
const REFERENCE_ORDER = [
    'Go to Definition', 'Go to Type Definition', 'Go to Source Definition', 'Go to Implementations', 'Go to References',
    'Add Symbol to Current Chat', 'Add Symbol to New Chat', 'Create Rule', 'Peek',
    'Find All References', 'Find All Implementations', 'Show Call Hierarchy',
    'Rename Symbol', 'Change All Occurrences', 'Format Document', 'Refactor...', 'Source Action...',
    'Open Changes', 'Open on Remote (Web)', 'File Annotations', 'File History', 'Git',
    'Cut', 'Copy', 'Copy As', 'Paste', 'Command Palette...'
];

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });

const makeRepo = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-menu-')));
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 'e2e@ingot.dev');
    git(dir, 'config', 'user.name', 'E2E Bot');
    git(dir, 'remote', 'add', 'origin', 'git@github.com:acme/shop.git');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'cart.ts'), 'export function addItem(id: string) {\n    return id;\n}\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'Add cart');
    git(dir, 'branch', 'feature/qty');
    fs.writeFileSync(path.join(dir, 'src', 'cart.ts'), 'export function addItem(id: string, qty = 1) {\n    return `${id}x${qty}`;\n}\n');
    return dir;
};

const treeNode = (page: Page, name: string) =>
    page.locator('#explorer-view-container .theia-TreeNode', { hasText: new RegExp(`^${name.replace('.', '\\.')}(?![\\w.])`) }).first();
const openCart = async (page: Page): Promise<void> => {
    await expect(treeNode(page, 'src')).toBeVisible({ timeout: 30_000 });
    await expect(async () => {
        await page.keyboard.press('Escape');
        await page.keyboard.press('Control+p');
        await expect(page.locator('.quick-input-widget input')).toBeVisible({ timeout: 2_000 });
        await page.locator('.quick-input-widget input').fill('cart.ts');
        await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'cart.ts' }).first().click({ timeout: 3_000 });
        await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('addItem', { timeout: 3_000 });
    }).toPass({ timeout: 40_000 });
};
const menuItems = (page: Page) => page.locator('.lm-Menu').first().locator('.lm-Menu-item');
const openMenu = async (page: Page): Promise<void> => {
    await expect(async () => {
        if (await page.locator('.lm-Menu').first().isVisible()) {
            await page.keyboard.press('Escape');
        }
        // Move off the tab bar so a path tooltip can't cover the first line.
        await page.mouse.move(600, 450);
        await page.waitForTimeout(300);
        await page.locator('.monaco-editor:not(.monaco-diff-editor .monaco-editor) .view-lines span >> visible=true', { hasText: 'addItem' }).first().click({ button: 'right' });
        await expect(page.locator('.lm-Menu').first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
};
const run = async (page: Page, ...labels: string[]): Promise<void> => {
    await openMenu(page);
    for (const [i, label] of labels.entries()) {
        const item = page.locator('.lm-Menu').nth(i).locator('.lm-Menu-item', { has: page.locator('.lm-Menu-itemLabel', { hasText: new RegExp(`^${label.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`) }) }).first();
        if (i < labels.length - 1) {
            await item.hover();
            await expect(page.locator('.lm-Menu').nth(i + 1)).toBeVisible();
        } else {
            await item.click();
        }
    }
};

test.describe('IDEA-56 editor context menu', () => {
    test.use({ permissions: ['clipboard-read', 'clipboard-write'] });
    let repo: string;

    test.beforeEach(() => { repo = makeRepo(); });
    test.afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

    test('lists the reference entries and runs AI, copy, Git and history actions', async ({ page }) => {
        await openIngot(page, repo);
        await dismissNotifications(page);
        await openCart(page);

        // Same entries, same order as the reference menu.
        await openMenu(page);
        const labels = (await menuItems(page).locator('.lm-Menu-itemLabel').allTextContents()).map(t => t.trim()).filter(Boolean);
        expect(labels).toEqual(REFERENCE_ORDER);
        await expect(menuItems(page).filter({ hasText: 'Create Rule' })).toHaveClass(/lm-mod-disabled/);
        await page.keyboard.press('Escape');

        // AI: the symbol under the cursor goes to the agent composer.
        await run(page, 'Add Symbol to Current Chat');
        await expect(page.locator('#ingot-composer-input')).toHaveText(/@src\/cart\.ts:1 addItem/);

        // Copy As: path, reference and markdown land on the clipboard.
        await run(page, 'Copy As', 'Copy Relative Path');
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('src/cart.ts');
        await run(page, 'Copy As', 'Copy Reference');
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('src/cart.ts:1 (addItem)');

        // Open on Remote: the web URL of this file on the origin remote.
        await run(page, 'Open on Remote (Web)', 'Copy Remote File URL');
        await expect.poll(() => page.evaluate(() => navigator.clipboard.readText())).toBe('https://github.com/acme/shop/blob/main/src/cart.ts#L1');

        // Open Changes with HEAD shows a diff editor.
        await run(page, 'Open Changes', 'Open Changes with HEAD');
        await expect(page.locator('.lm-TabBar-tab', { hasText: 'HEAD ↔ Working Tree' })).toBeVisible();
        await page.locator('.lm-TabBar-tab', { hasText: 'cart.ts' }).filter({ hasNotText: '↔' }).first().click();

        // File Annotations: blame shows the author next to each line.
        await run(page, 'File Annotations', 'Toggle Line Blame');
        await expect(page.locator('.ingot-blame-annotation', { hasText: 'Add cart' })).toHaveCount(1);
        // Word wrap is on by default, so a long annotation can wrap; its first fragment always holds "Uncommitted".
        await expect(page.locator('.ingot-blame-annotation', { hasText: 'Uncommitted' })).toHaveCount(2);
        await run(page, 'File Annotations', 'Toggle Line Blame');
        await expect(page.locator('.ingot-blame-annotation')).toHaveCount(0);

        // Git: commit just this file, then add it to .gitignore.
        await run(page, 'Git', 'Commit File…');
        await page.locator('.quick-input-widget input').fill('Support qty');
        await page.keyboard.press('Enter');
        await expect.poll(() => git(repo, 'log', '-1', '--format=%s').trim()).toBe('Support qty');
        await run(page, 'Git', 'Add to .gitignore');
        const gitignore = path.join(repo, '.gitignore');
        await expect.poll(() => fs.existsSync(gitignore) ? fs.readFileSync(gitignore, 'utf8') : '').toBe('/src/cart.ts\n');

        // Compare with Branch opens the diff against the picked branch.
        await run(page, 'Git', 'Compare with Branch…');
        await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'feature/qty' }).click();
        await expect(page.locator('.lm-TabBar-tab', { hasText: 'feature/qty ↔ Working Tree' })).toBeVisible();

        // Command Palette is the last entry.
        await page.locator('.lm-TabBar-tab', { hasText: 'cart.ts' }).filter({ hasNotText: '↔' }).first().click();
        await run(page, 'Command Palette...');
        await expect(page.locator('.quick-input-widget')).toBeVisible();
        await page.keyboard.press('Escape');
    });

    test('Create Rule turns the selection into a project rule; Rollback restores the file', async ({ page }) => {
        await openIngot(page, repo);
        await dismissNotifications(page);
        await openCart(page);

        await page.locator('.monaco-editor .view-lines').first().click();
        await page.keyboard.press('Control+a');
        await run(page, 'Create Rule');
        await page.locator('.quick-input-widget input').fill('Cart helpers');
        await page.keyboard.press('Enter');
        const rule = path.join(repo, '.ingot', 'rules', 'cart-helpers.md');
        await expect.poll(() => fs.existsSync(rule)).toBe(true);
        expect(fs.readFileSync(rule, 'utf8')).toContain('qty = 1');

        await page.locator('.lm-TabBar-tab', { hasText: 'cart.ts' }).first().click();
        await run(page, 'Git', 'Rollback…');
        await page.locator('.dialogBlock').getByRole('button', { name: 'Rollback' }).click();
        await expect.poll(() => fs.readFileSync(path.join(repo, 'src', 'cart.ts'), 'utf8')).not.toContain('qty');
        await expect(page.locator('.monaco-editor .view-lines').first()).not.toContainText('qty');
    });
});
