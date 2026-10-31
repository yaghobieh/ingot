import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';

/** IDEA-70 + IDEA-58: project tree file menu and editor tab menu, with the full Git submenu, on a real repository. */
const TREE_ORDER = [
    'New File…', 'New Folder…',
    'Open to the Side', 'Open in Browser', 'Open With…',
    'Open in Integrated Terminal', 'Select for Compare',
    'Add File to Agent Chat', 'Add File to New Agent Chat', 'Freeze for Agents',
    'Show Effective Rules',
    'Open Changes', 'Open on Remote (Web)',
    'File History', 'Open Timeline',
    'Cut', 'Copy', 'Paste',
    'Copy Path', 'Copy Relative Path', 'Copy Remote File URL', 'Copy Remote File URL From…',
    'Rename…', 'Delete',
    'Git'
];
const GIT_ITEMS = ['Commit File…', 'Add', 'Rollback…', 'Show Diff', 'Compare with Revision…', 'Compare with Branch…', 'Show History',
    'Annotate with Git Blame', 'Create Patch…', 'Apply Patch…', 'Add to .gitignore', 'Stash Changes…', 'Unstash…', 'Shelve Changes', 'Unshelve…',
    'Branches', 'Pull…', 'Fetch', 'Push…', 'Reset HEAD…', 'Manage Remotes…', 'Copy Revision Number'];

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });
const makeRepo = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-files-')));
    git(dir, 'init', '-q', '-b', 'main');
    git(dir, 'config', 'user.email', 'e2e@ingot.dev');
    git(dir, 'config', 'user.name', 'E2E Bot');
    git(dir, 'remote', 'add', 'origin', 'git@github.com:acme/shop.git');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'cart.ts'), 'export const cart = 1;\n');
    fs.writeFileSync(path.join(dir, 'README.md'), '# shop\n');
    git(dir, 'add', '.');
    git(dir, 'commit', '-q', '-m', 'Init');
    fs.writeFileSync(path.join(dir, 'README.md'), '# shop\n\nchanged\n');
    return dir;
};

const node = (page: Page, name: string): Locator =>
    page.locator('#explorer-view-container .theia-TreeNode').filter({ has: page.locator('.theia-TreeNodeSegmentGrow').getByText(name, { exact: true }) }).first();
const label = (text: string) => new RegExp(`^${text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')}$`);
const labels = async (menu: Locator): Promise<string[]> =>
    (await menu.locator(':scope > ul > .lm-Menu-item .lm-Menu-itemLabel, :scope .lm-Menu-content > .lm-Menu-item .lm-Menu-itemLabel').allTextContents()).map(t => t.trim()).filter(Boolean);
const openOn = async (page: Page, target: Locator): Promise<void> => {
    await expect(async () => {
        if (await page.locator('.lm-Menu').first().isVisible()) {
            await page.keyboard.press('Escape');
        }
        await target.click({ button: 'right' });
        await expect(page.locator('.lm-Menu').first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
};
const run = async (page: Page, target: Locator, ...path_: string[]): Promise<void> => {
    await openOn(page, target);
    for (const [i, text] of path_.entries()) {
        const item = page.locator('.lm-Menu').nth(i).locator('.lm-Menu-item', { has: page.locator('.lm-Menu-itemLabel', { hasText: label(text) }) }).first();
        if (i < path_.length - 1) {
            await item.hover();
            await expect(page.locator('.lm-Menu').nth(i + 1)).toBeVisible();
        } else {
            await item.click();
        }
    }
};
const clipboard = (page: Page) => page.evaluate(() => navigator.clipboard.readText());

test.describe('IDEA-70 / IDEA-58 file and tab menus', () => {
    test.use({ permissions: ['clipboard-read', 'clipboard-write'] });
    let repo: string;
    test.beforeEach(() => { repo = makeRepo(); });
    test.afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

    test('tree file menu lists the reference groups and its actions work', async ({ page }) => {
        await openIngot(page, repo);
        await dismissNotifications(page);
        await expect(node(page, 'README.md')).toBeVisible({ timeout: 30_000 });
        const readme = node(page, 'README.md');
        await readme.click();

        await openOn(page, readme);
        expect(await labels(page.locator('.lm-Menu').first())).toEqual(TREE_ORDER);
        await page.locator('.lm-Menu').first().locator('.lm-Menu-item', { has: page.locator('.lm-Menu-itemLabel', { hasText: label('Git') }) }).hover();
        await expect(page.locator('.lm-Menu').nth(1)).toBeVisible();
        const git_ = await labels(page.locator('.lm-Menu').nth(1));
        for (const item of GIT_ITEMS) {
            expect(git_, item).toContain(item);
        }
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');

        await run(page, readme, 'Copy Relative Path');
        await expect.poll(() => clipboard(page)).toBe('README.md');
        await run(page, readme, 'Copy Path');
        await expect.poll(() => clipboard(page)).toBe(path.join(repo, 'README.md'));
        await run(page, readme, 'Copy Remote File URL');
        await expect.poll(() => clipboard(page)).toBe('https://github.com/acme/shop/blob/main/README.md');

        // Open to the Side: the file opens again in a second editor group on the right.
        await run(page, readme, 'Open to the Side');
        await expect(page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: 'README.md' })).toHaveCount(2);
        await expect(page.locator('#theia-main-content-panel .lm-TabBar.theia-app-centers')).toHaveCount(2);

        // Add File to Agent Chat puts an @mention into the composer.
        await run(page, readme, 'Add File to Agent Chat');
        await expect(page.locator('#ingot-composer-input')).toHaveText(/@README\.md/);

        // Git ▸ Add stages it for real.
        await run(page, readme, 'Git', 'Add');
        await expect.poll(() => git(repo, 'diff', '--cached', '--name-only').trim()).toBe('README.md');
    });

    test('editor tab menu has pin/close/split, the file items and Git; actions use the clicked tab', async ({ page }) => {
        await openIngot(page, repo);
        await dismissNotifications(page);
        await expect(node(page, 'src')).toBeVisible({ timeout: 30_000 });
        await node(page, 'src').click();
        await expect(node(page, 'cart.ts')).toBeVisible();
        await node(page, 'cart.ts').dblclick();
        await node(page, 'README.md').dblclick();
        const cartTab = page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: 'cart.ts' });
        await expect(cartTab).toBeVisible();

        await openOn(page, cartTab);
        const items = await labels(page.locator('.lm-Menu').first());
        for (const item of ['Close', 'Close Others', 'Pin', 'Open to the Side', 'Reveal in Project', 'Open in Integrated Terminal',
            'Add File to Agent Chat', 'Copy Path', 'Copy Relative Path', 'Copy Remote File URL', 'Rename…', 'Delete', 'Git']) {
            expect(items, item).toContain(item);
        }
        await page.keyboard.press('Escape');

        // Copy Relative Path uses the right-clicked tab, not the active editor (README.md).
        await run(page, cartTab, 'Copy Relative Path');
        await expect.poll(() => clipboard(page)).toBe('src/cart.ts');

        // Git ▸ Show History on the tab opens the log filtered to that file.
        await run(page, cartTab, 'Git', 'Show History');
        await expect(page.locator('.ingot-git-log')).toContainText('Init');
    });
});
