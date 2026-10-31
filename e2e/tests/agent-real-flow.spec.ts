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
import { saveArtifact } from '../src/artifacts.e2e-utils';

/**
 * IDEA-248: a scripted local model (the same HTTP path a real model uses) reads this repo, runs a failing
 * check, fixes it, and commits a small change. Tool calls arrive as JSON and as printed shell, not only <<<TOOL.
 */
const REPO_ROOT = path.resolve(__dirname, '../..');
const RANK_FILE = 'packages/ingot-core/src/common/agents/chat-thread.ts';
const RANK_MARKER = 'showJumpToLatest';

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });
const edit = (file: string, body: string): string => `<<<EDIT ${file}\n${body}\n>>>END`;
const toolCall = (name: string, args: Record<string, unknown>): string =>
    `<tool_call>\n${JSON.stringify({ name: `ingot/${name}`, arguments: args })}\n</tool_call>`;

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
const FIXED = 'exports.total = (xs) => xs.reduce((a, b) => a + b, 0);\n';
const BANNER_FIXED = "exports.banner = () => 'Hello';\n";
const BANNER_TEST = [
    "const test = require('node:test');",
    "const assert = require('node:assert/strict');",
    "const { banner } = require('./banner.js');",
    '',
    "test('banner says hello', () => {",
    "    assert.equal(banner(), 'Hello');",
    '});',
    ''
].join('\n');

const gitCommit = (): string => [
    toolCall('git', { op: 'branch', name: 'feature/banner', checkout: true }),
    toolCall('git', { op: 'add', paths: ['.'] }),
    toolCall('git', { op: 'commit', message: 'Add the banner' })
].join('\n');

const initRepo = (prefix: string): string => {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'e2e@ingot.dev');
    git(repo, 'config', 'user.name', 'E2E Bot');
    return repo;
};

const saveShot = async (page: Page, name: string): Promise<void> => {
    await saveArtifact(page.locator('.ingot-agents'), name);
    await shot(page, name);
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

const explainReply = (user: string): string => {
    if (user.includes('picker ranks')) {
        return toolCall('read_file', { path: RANK_FILE });
    }
    if (user.startsWith('Tool result (ingot/read_file)')) {
        return user.includes(RANK_MARKER)
            ? `The @ picker walks project files. The helper in that file is ${RANK_MARKER}.`
            : 'READ FAILED';
    }
    if (user.includes('show me package.json')) {
        return '```bash\ncat package.json\n```';
    }
    if (user.startsWith('You printed shell commands')) {
        return 'The package name is ingot.';
    }
    return `Unexpected: ${user.slice(0, 180)}`;
};

const fixReply = (user: string): string => {
    if (user.startsWith('Check failed.')) {
        return edit('src/total.js', FIXED);
    }
    if (user.startsWith('Checks passed.') || user.includes('The commit was blocked')) {
        return 'The unit test passes.';
    }
    if (user.startsWith('Tool result (ingot/read_file)')) {
        return edit('src/total.test.js', TEST_FILE);
    }
    if (user.includes('total bug')) {
        return toolCall('read_file', { path: 'src/total.js' });
    }
    return `Unexpected: ${user.slice(0, 180)}`;
};

const featureReply = (user: string): string => {
    if (user.includes('ingot/summary') || user.includes('Result: committed')) {
        return 'Shipped the banner.';
    }
    if (user.startsWith('Check failed.')) {
        return edit('packages/cart/banner.js', BANNER_FIXED);
    }
    if (user.startsWith('Checks passed.') || user.includes('The commit was blocked')) {
        return gitCommit();
    }
    if (user.startsWith('Tool result (ingot/read_file)')) {
        return edit('packages/cart/banner.test.js', BANNER_TEST);
    }
    if (user.includes('banner feature')) {
        return toolCall('read_file', { path: 'packages/cart/banner.js' });
    }
    return `Unexpected: ${user.slice(0, 180)}`;
};

const startChat = async (page: Page, server: FakeOllama, folder: string): Promise<void> => {
    await openIngot(page, folder);
    await setAppearance(page, 'light');
    await dismissNotifications(page);
    await connectOllama(page, server);
    await page.locator('#ingot-agents-new').click();
    await pickModel(page, 'ollama-local');
};

test.describe('IDEA-248 real agent flow', () => {
    test.setTimeout(180_000);

    test('reads this repo locally, including a printed shell command', async ({ page }) => {
        const server = await startFakeOllama((_system, user) => explainReply(user), { delayMs: 0, chunkSize: 8_000 });
        try {
            await startChat(page, server, REPO_ROOT);
            await page.locator('#ingot-composer-input').fill('explain how the @ picker ranks files');
            await page.locator('#ingot-composer-input').press('Enter');
            await expect(page.locator('.ingot-agents-chat')).toContainText(RANK_MARKER, { timeout: 60_000 });
            await expect(page.locator('#ingot-composer-stop')).toHaveCount(0);
            await page.locator('#ingot-chat-explored .ingot-chat-explored-head').click();
            await expect(page.locator('.ingot-chat-explored-list')).toContainText('chat-thread.ts');
            await saveShot(page, 'agent-read-local-light.png');

            await page.locator('#ingot-composer-input').fill('show me package.json');
            await page.locator('#ingot-composer-input').press('Enter');
            await expect(page.locator('.ingot-agents-chat')).toContainText('The package name is ingot.', { timeout: 60_000 });
            expect(server.requests.some(request => request.users.some(text => text.includes('"name": "ingot"')))).toBe(true);
            expect(server.requests.some(request => request.users.some(text => text.includes('get_file_contents')))).toBe(false);
            const explored = page.locator('#ingot-chat-explored .ingot-chat-explored-head');
            if (await explored.getAttribute('aria-expanded') !== 'true') {
                await explored.click();
            }
            await expect(page.locator('.ingot-chat-explored-list')).toContainText('package.json');
            await saveShot(page, 'agent-read-shell-light.png');
        } finally {
            await server.close();
        }
    });

    test('adds a unit test, runs it, and fixes the failure', async ({ page }) => {
        const repo = initRepo('ingot-real-fix-');
        fs.mkdirSync(path.join(repo, 'src'));
        fs.writeFileSync(path.join(repo, 'src', 'total.js'), 'exports.total = (xs) => xs.reduce((a, b) => a - b, 0);\n');
        fs.writeFileSync(path.join(repo, 'package.json'), `${JSON.stringify({ name: 'cart', private: true, scripts: { test: 'node --test' } }, undefined, 2)}\n`);
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'Init');
        const server = await startFakeOllama((_system, user) => fixReply(user), { delayMs: 0, chunkSize: 8_000 });
        try {
            await startChat(page, server, repo);
            await setAutoAccept(page, true);
            await page.locator('#ingot-composer-input').fill('Fix the total bug and add a unit test');
            await page.locator('#ingot-composer-input').press('Enter');
            await expect(page.locator('.ingot-agents-chat')).toContainText('The unit test passes.', { timeout: 90_000 });
            await expect(page.locator('.ingot-tc-exit', { hasText: 'exit 1' }).first()).toBeVisible();
            await expect(page.locator('.ingot-tc-exit', { hasText: 'exit 0' }).first()).toBeVisible();
            await expect(page.locator('.ingot-agents-chat')).not.toContainText('failed three times');
            expect(fs.readFileSync(path.join(repo, 'src', 'total.js'), 'utf8')).toContain('a + b');
            expect(fs.readFileSync(path.join(repo, 'src', 'total.js'), 'utf8')).not.toContain('a - b');
            expect(fs.readFileSync(path.join(repo, 'src', 'total.test.js'), 'utf8')).toContain('adds the numbers');
            expect(git(repo, 'log', '-1', '--format=%s').trim()).toBe('Init');
            await page.locator('#ingot-chat-explored').click();
            await saveShot(page, 'agent-fix-pass-light.png');
        } finally {
            await setAutoAccept(page, false).catch(() => undefined);
            await server.close();
            fs.rmSync(repo, { recursive: true, force: true });
        }
    });

    test('edits a feature in a multi-package project, tests it, and commits', async ({ page }) => {
        const repo = initRepo('ingot-real-feature-');
        fs.mkdirSync(path.join(repo, 'packages', 'cart'), { recursive: true });
        fs.mkdirSync(path.join(repo, 'packages', 'ui'), { recursive: true });
        fs.writeFileSync(path.join(repo, 'package.json'), `${JSON.stringify({
            name: 'shop', private: true, workspaces: ['packages/*'],
            scripts: { test: 'node --test packages/cart/banner.test.js' }
        }, undefined, 2)}\n`);
        fs.writeFileSync(path.join(repo, 'packages', 'cart', 'package.json'), `${JSON.stringify({ name: 'cart', version: '0.0.0' })}\n`);
        fs.writeFileSync(path.join(repo, 'packages', 'ui', 'package.json'), `${JSON.stringify({ name: 'ui', version: '0.0.0' })}\n`);
        fs.writeFileSync(path.join(repo, 'packages', 'cart', 'banner.js'), "exports.banner = () => 'Nope';\n");
        git(repo, 'add', '.');
        git(repo, 'commit', '-q', '-m', 'Init');
        const server = await startFakeOllama((_system, user) => featureReply(user), { delayMs: 0, chunkSize: 8_000 });
        try {
            await startChat(page, server, repo);
            await setAutoAccept(page, true);
            await page.locator('#ingot-composer-input').fill('Add a small banner feature to packages/cart and commit');
            await page.locator('#ingot-composer-input').press('Enter');
            await approveUntilSummary(page);
            await expect(page.locator('#ingot-work-summary')).toContainText('feature/banner');
            await expect(page.locator('#ingot-work-summary')).toContainText('committed');
            await expect(page.locator('.ingot-tc-exit', { hasText: 'exit 1' }).first()).toBeVisible();
            await expect(page.locator('.ingot-tc-exit', { hasText: 'exit 0' }).first()).toBeVisible();
            expect(fs.readFileSync(path.join(repo, 'packages', 'cart', 'banner.js'), 'utf8')).toContain("'Hello'");
            expect(fs.readFileSync(path.join(repo, 'packages', 'cart', 'banner.test.js'), 'utf8')).toContain('banner says hello');
            expect(git(repo, 'branch', '--show-current').trim()).toBe('feature/banner');
            expect(git(repo, 'log', '-1', '--format=%s').trim()).toContain('Add the banner');
            await saveShot(page, 'agent-feature-commit-light.png');
        } finally {
            await setAutoAccept(page, false).catch(() => undefined);
            await server.close();
            fs.rmSync(repo, { recursive: true, force: true });
        }
    });
});
