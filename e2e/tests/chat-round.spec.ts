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

/** IDEA-248: thinking, reactions, a clickable turn summary, questions, steering, and two agents at once. */
const ARTIFACTS = '/opt/cursor/artifacts/screenshots';

const saveShot = async (page: Page, name: string, full = false): Promise<void> => {
    fs.mkdirSync(ARTIFACTS, { recursive: true });
    const target = full ? page : page.locator('.ingot-agents');
    await target.screenshot({ path: path.join(ARTIFACTS, name), animations: 'disabled' });
    await shot(page, name);
};

/** Headless Chrome follows a dark OS, so light shots set Light before the picture is taken. */
const useLight = async (page: Page): Promise<void> => {
    await setAppearance(page, 'light');
    await expect(page.locator('body')).toHaveClass(/ingot-light/);
};

const captureBoth = async (page: Page, base: string, full = false): Promise<void> => {
    await expect(page.locator('body')).toHaveClass(/ingot-light/);
    await saveShot(page, `${base}-light.png`, full);
    await setAppearance(page, 'dark');
    await expect(page.locator('body')).toHaveClass(/ingot-dark/);
    await saveShot(page, `${base}-dark.png`, full);
    await useLight(page);
};

const send = async (page: Page, text: string): Promise<void> => {
    await page.locator('#ingot-composer-input').fill(text);
    await page.locator('#ingot-composer-send').click();
};

const start = async (page: Page, server: FakeOllama): Promise<void> => {
    await openIngot(page);
    await dismissNotifications(page);
    await connectOllama(page, server);
    await page.locator('#ingot-agents-new').click();
    await pickModel(page, 'ollama-local');
    await useLight(page);
};

const toolCall = (name: string, args: Record<string, unknown>): string =>
    `<tool_call>\n${JSON.stringify({ name: `ingot/${name}`, arguments: args })}\n</tool_call>`;

test.describe('IDEA-248 chat round', () => {
    test('shows thinking, then reactions that survive a reload', async ({ page }) => {
        test.setTimeout(180_000);
        const server = await startFakeOllama(() => '<think>walk the names first</think>The picker ranks by name.', { delayMs: 0, chunkSize: 8_000 });
        try {
            await start(page, server);
            await send(page, 'show the thought');
            const thought = page.locator('#ingot-thought-1');
            await expect(thought).toContainText(/Thought for \d+s/);
            await thought.click();
            await expect(page.locator('.ingot-chat-thought-text')).toContainText('walk the names first');
            await captureBoth(page, 'thinking');

            await page.locator('#ingot-react-like-0').click();
            await expect(page.locator('#ingot-react-like-0')).toHaveAttribute('aria-pressed', 'true');
            await page.locator('#ingot-react-like-0').click();
            await expect(page.locator('#ingot-react-like-0')).toHaveAttribute('aria-pressed', 'false');
            await page.locator('#ingot-react-heart-1').click();
            await expect(page.locator('#ingot-react-heart-1')).toHaveAttribute('aria-pressed', 'true');
            await captureBoth(page, 'reactions');
            await page.reload();
            await expect(page.locator('#ingot-react-heart-1')).toHaveAttribute('aria-pressed', 'true', { timeout: 60_000 });
            await expect(page.locator('#ingot-react-like-0')).toHaveAttribute('aria-pressed', 'false');
        } finally {
            await server.close();
        }
    });

    test('asks a question, accepts an option, and takes a steer without stopping', async ({ page }) => {
        test.setTimeout(180_000);
        const server = await startFakeOllama((_system, user) => {
            if (user.includes('also mention tests')) {
                return 'Noted the tests.';
            }
            if (user.includes('ask_user') || user.includes('Ada')) {
                return 'Using Ada.';
            }
            if (user.includes('Name the banner')) {
                return toolCall('ask_user', { question: 'Which name?', options: ['Ada', 'Bea'] });
            }
            return `${'Still writing the note. '.repeat(80)}`;
        }, { delayMs: 30, chunkSize: 12 });
        try {
            await start(page, server);
            await send(page, 'Name the banner');
            await expect(page.locator('#ingot-ask-question')).toHaveText('Which name?');
            await expect(page.locator('#ingot-chat-tabs [data-run="waiting"]')).toHaveCount(1);
            await captureBoth(page, 'ask-user');
            await page.locator('.ingot-ask-option', { hasText: 'Ada' }).click();
            await expect(page.locator('.ingot-chat-agent .ingot-md').last()).toContainText('Using Ada.');
            await expect(page.locator('#ingot-ask')).toHaveCount(0);

            await send(page, 'Write a long note');
            await expect(page.locator('#ingot-composer-stop')).toBeVisible();
            await page.locator('#ingot-composer-input').fill('also mention tests');
            await page.locator('#ingot-composer-send').click();
            await expect(page.locator('.ingot-agents-chat')).toContainText('also mention tests');
            await expect(page.locator('.ingot-chat-agent .ingot-md').last()).toContainText('Noted the tests.', { timeout: 60_000 });
            expect(server.requests.some(request => request.users.some(text => text.includes('also mention tests')))).toBe(true);
        } finally {
            await server.close();
        }
    });

    test('runs a second agent while the first is still working', async ({ page }) => {
        test.setTimeout(180_000);
        const server = await startFakeOllama((_system, user) => user.includes('second agent') ? 'Second agent ready.' : `${'Keep going on the first task. '.repeat(80)}`, { delayMs: 40, chunkSize: 8 });
        try {
            await start(page, server);
            await send(page, 'first agent task');
            await expect(page.locator('#ingot-composer-stop')).toBeVisible();
            await page.locator('#ingot-agents-new').click();
            await send(page, 'second agent');
            await expect(page.locator('#ingot-chat-tabs [data-run="running"]')).toHaveCount(2);
            await captureBoth(page, 'multi-agent');
            await expect(page.locator('.ingot-chat-agent .ingot-md').last()).toContainText('Second agent ready.');
            await page.locator('#ingot-chat-tabs [role="tab"]').first().click();
            await expect(page.locator('.ingot-agents-chat')).not.toContainText('Second agent ready.');
        } finally {
            await server.close();
        }
    });

    test('lists the turn’s file and command, and each one opens', async ({ page }) => {
        test.setTimeout(240_000);
        const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-turn-')));
        execFileSync('git', ['init', '-q', '-b', 'feature/note'], { cwd: repo });
        execFileSync('git', ['config', 'user.email', 'e2e@ingot.dev'], { cwd: repo });
        execFileSync('git', ['config', 'user.name', 'E2E Bot'], { cwd: repo });
        fs.mkdirSync(path.join(repo, 'src'));
        fs.writeFileSync(path.join(repo, 'src', 'note.txt'), 'old\n');
        execFileSync('git', ['add', '.'], { cwd: repo });
        execFileSync('git', ['commit', '-q', '-m', 'Init'], { cwd: repo });
        const server = await startFakeOllama(() => [
            '<<<EDIT src/note.txt',
            'hello',
            '>>>END',
            toolCall('run', { command: 'node -e "console.log(1)"' }),
            toolCall('git', { op: 'commit', message: 'Update the note', paths: ['src/note.txt'] })
        ].join('\n'), { delayMs: 0, chunkSize: 8_000 });
        try {
            await openIngot(page, repo);
            await dismissNotifications(page);
            await connectOllama(page, server);
            const dialog = page.locator('#ingot-settings');
            await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), dialog);
            await page.locator('#ingot-settings-node-agent-review').click();
            const box = page.locator('#ingot-setting-ingot-agent-review-autoAccept');
            if (!await box.isChecked()) {
                await box.click();
            }
            await page.locator('#ingot-settings-ok').click();
            await useLight(page);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            await send(page, 'Update the note');
            const approve = page.locator('#ingot-approval-run');
            for (let i = 0; i < 4; i++) {
                await approve.click({ timeout: 20_000 });
                if (await page.locator('#ingot-turn-commit-0').isVisible().catch(() => false)) {
                    break;
                }
            }
            const file = page.locator('#ingot-turn-file-0');
            await expect(file).toContainText('src/note.txt');
            await expect(file).toContainText('+');
            await file.click();
            await expect(page.locator('#ingot-turn-command-0')).toContainText('node -e');
            await page.locator('#ingot-turn-command-0').click();
            await expect(page.locator('.ingot-tc-output, .ingot-tc').last()).toBeVisible();
            await expect(page.locator('#ingot-turn-commit-0')).toContainText('Update the note');
            await page.locator('#ingot-turn-commit-0').click();
            await expect(page.locator('.ingot-agents-chat')).toContainText('Update the note');
            await captureBoth(page, 'turn-activity');
            await captureBoth(page, 'agent-chat-all', true);
            if (await page.locator('#ingot-changes-summary').isVisible().catch(() => false)) {
                await page.locator('#ingot-changes-summary').click();
                await expect(page.locator('#ingot-review-files')).toBeHidden();
                await page.locator('#ingot-changes-summary').click();
                await expect(page.locator('#ingot-review-files')).toBeVisible();
            }
        } finally {
            await server.close();
            fs.rmSync(repo, { recursive: true, force: true });
        }
    });
});
