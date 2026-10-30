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
 * IDEA-261: the Test Explorer lists a vitest project's tests, runs them and reruns the failures, and the agent's
 * run_tests tool loops edit -> run -> fix until green, stopping at the iteration cap when it cannot fix them.
 */
const REPO_MODULES = path.resolve(__dirname, '../../node_modules');
const BROKEN = 'export const sum = (a, b) => a - b;\n';
const FIXED = 'export const sum = (a, b) => a + b;\n';
const SPEC = [
    "import { describe, expect, it } from 'vitest';",
    "import { sum } from './sum.js';",
    "describe('sum', () => {",
    "    it('adds two numbers', () => { expect(sum(1, 2)).toBe(3); });",
    "    it('keeps zero', () => { expect(sum(0, 0)).toBe(0); });",
    '});',
    ''
].join('\n');
const tool = (name: string, args: Record<string, unknown>): string => `<<<TOOL ingot/${name}\n${JSON.stringify(args)}\n>>>END`;
const edit = (file: string, body: string): string => `<<<EDIT ${file}\n${body}\n>>>END`;
const TOOL_RESULT = 'Tool result (ingot/run_tests)';
const ADDS_ID = 'src/sum.test.js::sum adds two numbers';
const ZERO_ID = 'src/sum.test.js::sum keeps zero';
const DEFAULT_MAX_ITERATIONS = 5;

const makeProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-tests-')));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'package.json'), `${JSON.stringify({ name: 'sum', private: true, type: 'module', scripts: { test: 'vitest run' } }, undefined, 2)}\n`);
    fs.writeFileSync(path.join(dir, 'src', 'sum.js'), BROKEN);
    fs.writeFileSync(path.join(dir, 'src', 'sum.test.js'), SPEC);
    fs.symlinkSync(REPO_MODULES, path.join(dir, 'node_modules'), 'dir');
    return dir;
};

const openExplorer = async (page: Page): Promise<void> => {
    // Playwright's Desktop Chrome reports Windows, so the Test Explorer tool window is Alt+8.
    await actUntilVisible(() => page.keyboard.press('Alt+8'), page.locator('#ingot-test-explorer'));
};

const setAutoAccept = async (page: Page, on: boolean): Promise<void> => {
    const dialog = page.locator('#ingot-settings');
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), dialog);
    await page.locator('#ingot-settings-node-agent-review').click();
    const box = page.locator('#ingot-setting-ingot-agent-review-autoAccept');
    if (await box.isChecked() !== on) {
        await box.click();
    }
    await page.locator('#ingot-settings-ok').click();
    await expect(dialog).toBeHidden();
};

test.describe('IDEA-261 test explorer and agent test loop', () => {
    test.setTimeout(180_000);
    let dir = '';
    let server: FakeOllama | undefined;

    test.afterEach(async ({ page }) => {
        await setAutoAccept(page, false).catch(() => undefined);
        await server?.close();
        server = undefined;
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('lists tests, runs all, and reruns only the failure after a fix', async ({ page }) => {
        dir = makeProject();
        await openIngot(page, dir);
        await setAppearance(page, 'light');
        await dismissNotifications(page);
        await openExplorer(page);

        const explorer = page.locator('#ingot-test-explorer');
        await expect(explorer.locator('#ingot-tests-runner')).toHaveText('vitest');
        await expect(explorer.locator('.ingot-tests-file[data-path="src/sum.test.js"]')).toBeVisible();
        await expect(explorer.locator('.ingot-tests-case')).toHaveCount(2);
        await expect(explorer.locator('#ingot-tests-rerun-failed')).toBeDisabled();

        await explorer.locator('#ingot-tests-run-all').click();
        await expect(explorer.locator(`.ingot-tests-case[data-id="${ADDS_ID}"]`)).toHaveAttribute('data-state', 'failed', { timeout: 60_000 });
        await expect(explorer.locator(`.ingot-tests-case[data-id="${ZERO_ID}"]`)).toHaveAttribute('data-state', 'passed');
        await expect(explorer.locator('.ingot-tests-message')).toContainText('expected -1 to be 3');
        await expect(explorer.locator('#ingot-tests-summary')).toContainText('1 passed');
        await expect(explorer.locator('#ingot-tests-summary')).toContainText('1 failed');
        await expect(explorer.locator('#ingot-tests-rerun-failed')).toHaveText(/Rerun Failed \(1\)/);
        await shot(page, 'idea-261-explorer-failed-light.png');

        // Clicking a test opens its file at the test's line.
        await explorer.locator(`.ingot-tests-case[data-id="${ADDS_ID}"] .ingot-tests-row`).click();
        await expect(page.locator('#theia-main-content-panel .lm-TabBar-tab.lm-mod-current', { hasText: 'sum.test.js' }).first()).toBeVisible();

        fs.writeFileSync(path.join(dir, 'src', 'sum.js'), FIXED);
        await explorer.locator('#ingot-tests-rerun-failed').click();
        await expect(explorer.locator(`.ingot-tests-case[data-id="${ADDS_ID}"]`)).toHaveAttribute('data-state', 'passed', { timeout: 60_000 });
        await expect(explorer.locator('#ingot-tests-summary')).toContainText('1 passed');
        await expect(explorer.locator('#ingot-tests-summary')).toContainText('0 failed');
        await expect(explorer.locator('.ingot-tests-file[data-path="src/sum.test.js"]')).toHaveAttribute('data-state', 'passed');
        await expect(explorer.locator('#ingot-tests-rerun-failed')).toBeDisabled();

        // Run All Tests is also a shortcut (Ctrl+Shift+F10 on Windows/Linux).
        await page.keyboard.press('Control+Shift+F10');
        await expect(explorer.locator('#ingot-tests-summary')).toContainText('2 passed', { timeout: 60_000 });
        await setAppearance(page, 'dark');
        await shot(page, 'idea-261-explorer-green-dark.png');
        await setAppearance(page, 'light');
    });

    test('the agent loops edit, run_tests, fix until green and the explorer shows the result', async ({ page }) => {
        dir = makeProject();
        server = await startFakeOllama((_system, user) => {
            if (user.startsWith(TOOL_RESULT) && user.includes('"status":"passed"')) {
                return 'All tests pass now.';
            }
            if (user.startsWith(TOOL_RESULT) && user.includes('"status":"failed"')) {
                return `${edit('src/sum.js', FIXED)}\n${tool('run_tests', { failedOnly: true })}`;
            }
            return tool('run_tests', {});
        }, { delayMs: 0, chunkSize: 8_000 });
        await openIngot(page, dir);
        await setAppearance(page, 'light');
        await dismissNotifications(page);
        await setAutoAccept(page, true);
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await page.locator('#ingot-composer-input').fill('make the sum tests green');
        await page.locator('#ingot-composer-input').press('Enter');

        await expect(page.locator('#ingot-approval-line')).toHaveText('Run tests: all tests', { timeout: 30_000 });
        // One Always Run covers the later run_tests calls of the loop.
        await page.locator('#ingot-approval-always').click();
        await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('All tests pass now.', { timeout: 90_000 });

        const results = server.requests.map(request => request.user).filter(user => user.startsWith(TOOL_RESULT));
        expect(results).toHaveLength(2);
        expect(results[0]).toContain('Tests FAILED: 1 failed, 1 passed, 0 skipped (vitest');
        expect(results[0]).toContain('"failures":[{"file":"src/sum.test.js","line":4,"name":"sum › adds two numbers"');
        expect(results[1]).toContain('Tests passed: 0 failed, 1 passed, 0 skipped');
        expect(fs.readFileSync(path.join(dir, 'src', 'sum.js'), 'utf8').trim()).toBe(FIXED.trim());
        await expect(page.locator('.ingot-tc-title', { hasText: 'Ran tests' }).first()).toBeVisible();

        await openExplorer(page);
        await expect(page.locator(`#ingot-test-explorer .ingot-tests-case[data-id="${ADDS_ID}"]`)).toHaveAttribute('data-state', 'passed');
        // The failed-only rerun leaves the earlier pass of the other test in place.
        await expect(page.locator(`#ingot-test-explorer .ingot-tests-case[data-id="${ZERO_ID}"]`)).toHaveAttribute('data-state', 'passed');
        await shot(page, 'idea-261-agent-loop-light.png');
    });

    test('the agent stops at the iteration cap when the tests stay red', async ({ page }) => {
        dir = makeProject();
        server = await startFakeOllama((_system, user) => {
            if (user.startsWith(TOOL_RESULT) && user.includes('Stop: the test loop reached its iteration cap')) {
                return 'Stopped: sum still subtracts.';
            }
            return tool('run_tests', { failedOnly: true });
        }, { delayMs: 0, chunkSize: 8_000 });
        await openIngot(page, dir);
        await dismissNotifications(page);
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await page.locator('#ingot-composer-input').fill('make the sum tests green');
        await page.locator('#ingot-composer-input').press('Enter');
        await expect(page.locator('#ingot-approval-line')).toHaveText('Run tests: failed only', { timeout: 30_000 });
        await page.locator('#ingot-approval-always').click();
        await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('Stopped: sum still subtracts.', { timeout: 120_000 });

        const results = server.requests.map(request => request.user).filter(user => user.startsWith(TOOL_RESULT));
        expect(results).toHaveLength(DEFAULT_MAX_ITERATIONS);
        expect(results[results.length - 1]).toContain(`Iteration ${DEFAULT_MAX_ITERATIONS} of ${DEFAULT_MAX_ITERATIONS}`);
        expect(fs.readFileSync(path.join(dir, 'src', 'sum.js'), 'utf8')).toBe(BROKEN);
    });
});
