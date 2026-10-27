import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/**
 * IDEA-248: a scripted model fixes a seeded bug (failing test, green checks, feature-branch commit,
 * pre-commit hook blocks then passes) and ships a small page with a Playwright spec run before the commit.
 */
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });
const tool = (name: string, args: Record<string, unknown>): string => `<<<TOOL ingot/${name}\n${JSON.stringify(args)}\n>>>END`;
const edit = (file: string, body: string): string => `<<<EDIT ${file}\n${body}\n>>>END`;

const TEST_FILE = [
    "const test = require('node:test');",
    "const assert = require('node:assert/strict');",
    "const { total } = require('./total.js');",
    '',
    "test('adds the numbers', () => {",
    '    assert.equal(total([1, 2]), 3);',
    '});',
    ''
].join('\n');
const WITH_MARKER = '// FIXME\nexports.total = (xs) => xs.reduce((a, b) => a + b, 0);\n';
const FIXED = 'exports.total = (xs) => xs.reduce((a, b) => a + b, 0);\n';
const BANNER_HTML = '<!doctype html>\n<html><body><h1 data-testid="banner">Hello</h1></body></html>\n';
const BANNER_SPEC = [
    "import { test, expect } from '@playwright/test';",
    '',
    "test('shows the banner', async ({ page }) => {",
    "    await page.goto('/');",
    "    await expect(page.getByTestId('banner')).toBeVisible();",
    '});',
    ''
].join('\n');

const gitCommit = (message: string): string => [
    tool('git', { op: 'add', paths: ['.'] }),
    tool('git', { op: 'commit', message })
].join('\n');
const gitBranchCommit = (name: string, message: string): string => [
    tool('git', { op: 'branch', name, checkout: true }),
    gitCommit(message)
].join('\n');

const initRepo = (prefix: string): string => {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'e2e@ingot.dev');
    git(repo, 'config', 'user.name', 'E2E Bot');
    return repo;
};

const bugReply = (user: string): string => {
    if (user.includes('ingot/summary') || user.includes('Result: committed')) {
        return 'The cart total adds the numbers.';
    }
    if (user.includes('blocked by .ingot hooks')) {
        return edit('src/total.js', FIXED);
    }
    if (user.includes('The commit was blocked')) {
        return gitCommit('Fix cart total');
    }
    if (user.startsWith('Check failed.')) {
        return edit('src/total.js', WITH_MARKER);
    }
    if (user.startsWith('Checks passed.')) {
        return gitBranchCommit('feature/fix-total', 'Fix cart total');
    }
    if (user.startsWith('Tool result (ingot/read_file)')) {
        return edit('src/total.test.js', TEST_FILE);
    }
    if (user.startsWith('Tool result (ingot/glob)')) {
        return tool('read_file', { path: 'src/total.js' });
    }
    if (user.includes('cart total')) {
        return tool('glob', { pattern: '**/*.js' });
    }
    return `Unexpected: ${user.slice(0, 180)}`;
};

const featureReply = (user: string): string => {
    if (user.includes('ingot/summary') || user.includes('Result: committed')) {
        return 'Shipped the banner.';
    }
    if (user.includes('The commit was blocked')) {
        return gitCommit('Add the banner');
    }
    if (user.startsWith('Check failed.') || user.startsWith('Add an end-to-end test.')) {
        return `${edit('index.html', BANNER_HTML)}\n${edit('e2e/banner.spec.ts', BANNER_SPEC)}`;
    }
    if (user.startsWith('Checks passed.')) {
        return gitBranchCommit('feature/banner', 'Add the banner');
    }
    if (user.includes('hello banner')) {
        return [
            'PLAN:',
            '- Add the banner to index.html',
            '- Add a Playwright spec',
            '- Run the checks and commit',
            '',
            edit('index.html', BANNER_HTML),
            edit('e2e/banner.spec.ts', BANNER_SPEC)
        ].join('\n');
    }
    return `Unexpected: ${user.slice(0, 180)}`;
};

const setAutoAccept = async (page: Page, on: boolean): Promise<void> => {
    const dialog = page.locator('#ingot-settings');
    if (await dialog.isHidden()) {
        await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), dialog);
    }
    await page.locator('#ingot-settings-node-agent-review').click();
    const box = page.locator('#ingot-setting-ingot-agent-review-autoAccept');
    await expect(box).toBeVisible();
    if (await box.isChecked() !== on) {
        await box.click();
    }
    await page.locator('#ingot-settings-ok').click();
    await expect(dialog).toBeHidden();
};

/** Git branch / add / commit still ask. Project checks do not. Click Run until the summary card is up. */
const approveUntilSummary = async (page: Page): Promise<void> => {
    const deadline = Date.now() + 150_000;
    while (Date.now() < deadline) {
        const run = page.locator('#ingot-approval-run');
        if (await run.isVisible().catch(() => false)) {
            await run.click().catch(() => undefined);
        }
        const harmony = page.locator('#ingot-harmony-dismiss');
        if (await harmony.isVisible().catch(() => false)) {
            await harmony.click().catch(() => undefined);
        }
        if (await page.locator('#ingot-work-summary').isVisible().catch(() => false)) {
            return;
        }
        await page.waitForTimeout(250);
    }
    const last = await page.locator('.ingot-agents .ingot-chat-agent').last().innerText().catch(() => '');
    throw new Error(`work loop did not commit.\n${last.slice(0, 500)}`);
};

test.describe('IDEA-248 agent work loop', () => {
    test.setTimeout(180_000);
    let repo = '';
    let server: FakeOllama | undefined;

    test.afterEach(async ({ page }) => {
        await setAutoAccept(page, false).catch(() => undefined);
        await server?.close();
        if (repo) {
            fs.rmSync(repo, { recursive: true, force: true });
        }
    });

    test('fixes a seeded bug, reruns checks, and commits only after the hook passes', async ({ page }) => {
        repo = initRepo('ingot-work-loop-');
        fs.mkdirSync(path.join(repo, 'src'));
        fs.mkdirSync(path.join(repo, '.ingot'));
        fs.writeFileSync(path.join(repo, '.gitignore'), 'secret.txt\n');
        fs.writeFileSync(path.join(repo, 'secret.txt'), 'SECRET-TOKEN\n');
        fs.writeFileSync(path.join(repo, 'src', 'total.js'), 'exports.total = (xs) => xs.reduce((a, b) => a - b, 0);\n');
        fs.writeFileSync(path.join(repo, 'package.json'), `${JSON.stringify({ name: 'cart', private: true, scripts: { test: 'node --test' } }, undefined, 2)}\n`);
        fs.writeFileSync(path.join(repo, '.ingot', 'hooks.json'), `${JSON.stringify({
            'pre-commit': [{
                name: 'No debug marker',
                run: "node -e \"const fs=require('fs');const s=fs.readFileSync('src/total.js','utf8');if(s.includes('FIXME')){console.log('src/total.js:1: remove FIXME');process.exit(1)}\""
            }]
        }, undefined, 2)}\n`);
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'Init');
        expect(git(repo, 'ls-files')).not.toContain('secret.txt');

        server = await startFakeOllama((_system, user) => bugReply(user), { delayMs: 0, chunkSize: 8_000 });
        await openIngot(page, repo);
        await setAppearance(page, 'light');
        await dismissNotifications(page);
        await setAutoAccept(page, true);
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await page.locator('#ingot-composer-input').fill('Fix the cart total bug and commit');
        await page.locator('#ingot-composer-input').press('Enter');
        await approveUntilSummary(page);

        await expect(page.locator('#ingot-work-summary')).toContainText('feature/fix-total');
        await expect(page.locator('#ingot-work-summary')).toContainText('committed');
        await expect(page.locator('.ingot-agents-chat')).toContainText('blocked by .ingot hooks');
        await expect(page.locator('.ingot-tc-exit', { hasText: 'exit 1' }).first()).toBeVisible();
        await expect(page.locator('.ingot-tc-exit', { hasText: 'exit 0' }).first()).toBeVisible();
        await expect(page.locator('#ingot-chat-explored')).toBeVisible();
        const fixed = fs.readFileSync(path.join(repo, 'src', 'total.js'), 'utf8');
        expect(fixed).toContain('a + b');
        expect(fixed).not.toContain('FIXME');
        expect(fixed).not.toContain('a - b');
        expect(fs.readFileSync(path.join(repo, 'src', 'total.test.js'), 'utf8')).toContain('adds the numbers');
        expect(git(repo, 'branch', '--show-current').trim()).toBe('feature/fix-total');
        expect(git(repo, 'log', '-1', '--format=%s').trim()).toContain('Fix cart total');
        expect(git(repo, 'ls-files')).not.toContain('secret.txt');
        expect(server.requests.some(request => request.system.includes('source of truth'))).toBe(true);
        expect(server.requests.some(request => request.user.includes('SECRET-TOKEN') || request.system.includes('SECRET-TOKEN'))).toBe(false);
        await shot(page, 'work-loop-bug-light.png');
    });

    test('ships a banner with a Playwright spec and runs that check before the commit', async ({ page }) => {
        repo = initRepo('ingot-work-feature-');
        fs.mkdirSync(path.join(repo, 'e2e'));
        fs.writeFileSync(path.join(repo, 'package.json'), `${JSON.stringify({
            name: 'shop', private: true,
            scripts: { test: 'node --test', e2e: 'node --test e2e/banner.test.js' }
        }, undefined, 2)}\n`);
        fs.writeFileSync(path.join(repo, 'playwright.config.ts'), "export default { testDir: 'e2e' };\n");
        fs.writeFileSync(path.join(repo, 'index.html'), '<!doctype html>\n<html><body><h1>Shop</h1></body></html>\n');
        fs.writeFileSync(path.join(repo, 'e2e', 'banner.test.js'), [
            "const test = require('node:test');",
            "const assert = require('node:assert/strict');",
            "const fs = require('fs');",
            "test('banner is on the page and in the Playwright spec', () => {",
            "    const html = fs.readFileSync('index.html', 'utf8');",
            "    const spec = fs.readFileSync('e2e/banner.spec.ts', 'utf8');",
            '    assert.match(html, /data-testid="banner"/);',
            "    assert.match(spec, /getByTestId\\('banner'\\)/);",
            '    assert.match(spec, /test\\(/);',
            '});',
            ''
        ].join('\n'));
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'Init');

        server = await startFakeOllama((_system, user) => featureReply(user), { delayMs: 0, chunkSize: 8_000 });
        await openIngot(page, repo);
        await setAppearance(page, 'dark');
        await dismissNotifications(page);
        await setAutoAccept(page, true);
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await page.locator('#ingot-composer-input').fill('Add a hello banner feature with data-testid="banner" to index.html and a Playwright test, then commit');
        await page.locator('#ingot-composer-input').press('Enter');
        await expect(page.locator('.ingot-chat-plan')).toBeVisible({ timeout: 30_000 });
        await approveUntilSummary(page);

        await expect(page.locator('#ingot-work-summary')).toContainText('feature/banner');
        await expect(page.locator('#ingot-work-summary')).toContainText('npm run e2e passed');
        expect(fs.readFileSync(path.join(repo, 'index.html'), 'utf8')).toContain('data-testid="banner"');
        expect(fs.readFileSync(path.join(repo, 'e2e', 'banner.spec.ts'), 'utf8')).toContain("test('shows the banner'");
        expect(git(repo, 'branch', '--show-current').trim()).toBe('feature/banner');
        expect(git(repo, 'log', '-1', '--format=%s').trim()).toContain('Add the banner');
        await shot(page, 'work-loop-feature-dark.png');
    });
});
