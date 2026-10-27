import { execFileSync, spawnSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot, runCommand } from '../src/app.utils';

/** IDEA-178: agent git hooks from .ingot/hooks.json. A failing step blocks the commit (tool cards), with Fix with agent or Bypass. */
const SHOTS_DIR = process.env.INGOT_SHOTS_DIR;
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });

const FAILING = { name: 'Unit tests', run: 'node -e "console.log(\'cart.test.ts: 2 tests failed\'); process.exit(1)"' };
const PASSING = { name: 'Lint', run: 'node -e "console.log(\'lint ok\')"' };

const makeRepo = (steps: readonly object[]): { repo: string; base: string } => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-hooks-')));
    const repo = path.join(base, 'shop');
    fs.mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'e2e@ingot.dev');
    git(repo, 'config', 'user.name', 'E2E Bot');
    fs.mkdirSync(path.join(repo, '.ingot'));
    fs.writeFileSync(path.join(repo, '.ingot', 'hooks.json'), JSON.stringify({ 'pre-commit': steps }, undefined, 2));
    fs.writeFileSync(path.join(repo, 'cart.ts'), 'export const total = 1;\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '--no-verify', '-m', 'Init');
    fs.writeFileSync(path.join(repo, 'cart.ts'), 'export const total = 2;\n');
    return { repo, base };
};

const useScheme = async (page: Page, scheme: 'light' | 'dark', repo: string): Promise<void> => {
    await page.emulateMedia({ colorScheme: scheme });
    await openIngot(page, repo);
    await page.locator('#ingot-rs-theme').click();
    await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'System' }).first().click();
    await expect(page.locator('body')).toHaveClass(new RegExp(`ingot-${scheme}`));
    await dismissNotifications(page);
};

const win = (page: Page) => page.locator('#ingot-commit-window');
const dialog = (page: Page) => page.locator('#ingot-hooks-dialog');

const commitFromWindow = async (page: Page, message: string): Promise<void> => {
    await actUntilVisible(() => page.locator('#status-bar-ingot-status-commit-window').click(), win(page));
    await win(page).locator('#ingot-cw-message').fill(message);
    await win(page).locator('#ingot-cw-commit').click();
};

const shot = async (page: Page, name: string, target = page.locator('body')): Promise<void> => {
    if (SHOTS_DIR) {
        fs.mkdirSync(SHOTS_DIR, { recursive: true });
        await page.mouse.move(0, 0);
        await target.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) });
    }
};

test.describe('IDEA-178 agent git hooks', () => {
    let base = '';
    test.afterEach(() => {
        if (base) {
            fs.rmSync(base, { recursive: true, force: true });
        }
    });

    for (const scheme of ['light', 'dark'] as const) {
        test(`a failing pre-commit step blocks the commit and shows its card; Bypass commits (${scheme})`, async ({ page }) => {
            const made = makeRepo([PASSING, FAILING, { name: 'Review the diff', agent: 'Look for debug code.' }]);
            base = made.base;
            await useScheme(page, scheme, made.repo);
            await commitFromWindow(page, 'Bump total');

            await expect(dialog(page)).toBeVisible({ timeout: 30_000 });
            await expect(dialog(page).locator('#ingot-hooks-summary')).toContainText('"Unit tests" failed');
            const steps = dialog(page).locator('.ingot-hooks-step');
            await expect(steps).toHaveCount(3);
            await expect(steps.nth(0)).toHaveClass(/passed/);
            await expect(steps.nth(1)).toHaveClass(/failed/);
            await expect(steps.nth(1).locator('.ingot-tc-terminal')).toContainText('2 tests failed');
            await expect(steps.nth(2)).toHaveClass(/skipped/);
            await expect(steps.nth(2)).toContainText('not run');
            await expect(dialog(page).locator('#ingot-hooks-fix')).toBeVisible();
            await expect(dialog(page).locator('#ingot-hooks-bypass')).toHaveText('Bypass and commit');
            expect(git(made.repo, 'log', '-1', '--format=%s').trim()).toBe('Init');
            await shot(page, `agent-hooks-blocked-${scheme}`);
            await shot(page, `agent-hooks-blocked-crop-${scheme}`, dialog(page));

            await dialog(page).locator('#ingot-hooks-bypass').click();
            await expect.poll(() => git(made.repo, 'log', '-1', '--format=%s').trim()).toBe('Bump total');
        });
    }

    test('Fix with agent opens a chat with the failing output; nothing is committed', async ({ page }) => {
        const made = makeRepo([FAILING]);
        base = made.base;
        await useScheme(page, 'light', made.repo);
        await commitFromWindow(page, 'Bump total');
        await expect(dialog(page)).toBeVisible({ timeout: 30_000 });
        await dialog(page).locator('#ingot-hooks-fix').click();
        await expect(dialog(page)).toHaveCount(0);
        await expect(page.locator('.ingot-agents .ingot-chat-user').last()).toContainText('The pre-commit hook failed', { timeout: 20_000 });
        await expect(page.locator('.ingot-agents .ingot-chat-user').last()).toContainText('2 tests failed');
        expect(git(made.repo, 'log', '-1', '--format=%s').trim()).toBe('Init');
    });

    test('passing steps let the commit through; installed git hooks run the shell steps for terminal commits', async ({ page }) => {
        const made = makeRepo([PASSING]);
        base = made.base;
        await useScheme(page, 'light', made.repo);
        await commitFromWindow(page, 'Bump total');
        await expect.poll(() => git(made.repo, 'log', '-1', '--format=%s').trim(), { timeout: 30_000 }).toBe('Bump total');
        await expect(dialog(page)).toHaveCount(0);

        // Install the git hooks, then a failing step blocks a terminal commit (and --no-verify bypasses it).
        fs.writeFileSync(path.join(made.repo, '.ingot', 'hooks.json'), JSON.stringify({ 'pre-commit': [FAILING] }));
        await runCommand(page, 'Install Agent Git Hooks');
        const hook = path.join(made.repo, '.git', 'hooks', 'pre-commit');
        await expect.poll(() => fs.existsSync(hook) && (fs.statSync(hook).mode & 0o111) !== 0, { timeout: 15_000 }).toBe(true);
        expect(fs.readFileSync(hook, 'utf8')).toContain('ingot-agent-hooks');
        fs.writeFileSync(path.join(made.repo, 'cart.ts'), 'export const total = 3;\n');
        git(made.repo, 'add', 'cart.ts');
        const blocked = spawnSync('git', ['commit', '-m', 'From the terminal'], { cwd: made.repo, encoding: 'utf8' });
        expect(blocked.status).not.toBe(0);
        expect(`${blocked.stdout}${blocked.stderr}`).toContain('2 tests failed');
        git(made.repo, 'commit', '-q', '--no-verify', '-m', 'From the terminal');
        expect(git(made.repo, 'log', '-1', '--format=%s').trim()).toBe('From the terminal');
    });

    test('Create Agent Git Hooks writes the template and opens it', async ({ page }) => {
        const made = makeRepo([]);
        base = made.base;
        fs.rmSync(path.join(made.repo, '.ingot'), { recursive: true, force: true });
        await useScheme(page, 'light', made.repo);
        await runCommand(page, 'Create Agent Git Hooks');
        const file = path.join(made.repo, '.ingot', 'hooks.json');
        await expect.poll(() => fs.existsSync(file), { timeout: 15_000 }).toBe(true);
        const config = JSON.parse(fs.readFileSync(file, 'utf8'));
        expect(config['pre-commit'].length).toBeGreaterThan(0);
        await expect(page.locator('.p-TabBar-tab.p-mod-current, .lm-TabBar-tab.lm-mod-current').filter({ hasText: 'hooks.json' }).first()).toBeVisible();
    });
});
