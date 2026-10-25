import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { launchDesktop, type DesktopApp } from '../src/electron.utils';

const SHOTS = process.env.INGOT_SHOTS;
const shot = async (page: Page, name: string): Promise<void> => {
    if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, name) });
    }
};

/** IDEA-122: in the desktop app ⌘K opens Commit and ⇧⌘K opens Push with ONE press, whatever has focus (editor, tree, terminal). */
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });
const MOD = process.platform === 'darwin' ? 'Meta' : 'Control';

const makeRepo = (ahead: boolean): string => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-commit-keys-')));
    const remote = path.join(base, 'remote.git');
    const repo = path.join(base, 'shop');
    git(base, 'init', '-q', '--bare', '-b', 'main', remote);
    fs.mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'e2e@ingot.dev');
    git(repo, 'config', 'user.name', 'E2E Bot');
    git(repo, 'remote', 'add', 'origin', `file://${remote}`);
    fs.writeFileSync(path.join(repo, 'a.ts'), 'export const a = 1;\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'Init');
    git(repo, 'push', '-q', '-u', 'origin', 'main');
    fs.writeFileSync(path.join(repo, 'a.ts'), 'export const a = 2;\n');
    if (ahead) {
        fs.writeFileSync(path.join(repo, 'b.ts'), 'export const b = 1;\n');
        git(repo, 'add', 'b.ts');
        git(repo, 'commit', '-q', '-m', 'Local change');
    }
    return repo;
};

const focusEditor = async (page: Page): Promise<void> => {
    const node = page.locator('#explorer-view-container .theia-TreeNode', { hasText: 'a.ts' }).first();
    await expect(node).toBeVisible({ timeout: 20_000 });
    await node.dblclick();
    const editor = page.locator('#theia-main-content-panel .monaco-editor .view-lines').first();
    await expect(editor).toBeVisible();
    await editor.click();
};

test.describe('IDEA-122 commit and push shortcuts (desktop)', () => {
    let repo: string;
    let desktop: DesktopApp;
    test.beforeEach(async () => {
        repo = makeRepo(test.info().title.includes('Push'));
        desktop = await launchDesktop(repo);
    });
    test.afterEach(async () => {
        await desktop?.close();
        fs.rmSync(path.dirname(repo), { recursive: true, force: true });
    });

    test('⌘K from the editor opens the Commit window with one press', async () => {
        const { page } = desktop;
        await focusEditor(page);
        await page.keyboard.press(`${MOD}+k`);
        await expect(page.locator('#ingot-commit-message')).toBeVisible({ timeout: 4_000 });
        await expect(page.locator('.ingot-lc-file[data-path="a.ts"]')).toBeVisible({ timeout: 15_000 });
        await shot(page, '122-commit-before.png');
    });

    test('⇧⌘K from the editor opens the Push window with one press', async () => {
        const { page } = desktop;
        await focusEditor(page);
        await page.keyboard.press(`${MOD}+Shift+k`);
        await expect(page.locator('.dialogBlock .dialogTitle')).toContainText('Push', { timeout: 4_000 });
        await page.waitForTimeout(800);
        await shot(page, '122-push-before.png');
    });

    test('⇧⌘K from the project tree opens Push, not Rerun Last Task', async () => {
        const { page } = desktop;
        await page.locator('#explorer-view-container .theia-TreeNode', { hasText: 'a.ts' }).first().click();
        await page.keyboard.press(`${MOD}+Shift+k`);
        await expect(page.locator('.dialogBlock .dialogTitle')).toContainText('Push', { timeout: 4_000 });
    });

    test('⌘K from the project tree opens the Commit window', async () => {
        const { page } = desktop;
        await page.locator('#explorer-view-container .theia-TreeNode', { hasText: 'a.ts' }).first().click();
        await page.keyboard.press(`${MOD}+k`);
        await expect(page.locator('#ingot-commit-message')).toBeVisible({ timeout: 4_000 });
    });
});
