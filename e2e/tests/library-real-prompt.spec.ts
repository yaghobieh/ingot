import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { makeToolsProject, setAppearance } from '../src/agent-tools.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { SHELL_SELECTOR } from '../src/e2e.consts';

/**
 * The words are the prompt that failed in real use. Only the folder is a temp path,
 * so the test can write it. The stand-in model repeats the prompt, which is what the
 * hosted model did, and must not get a summary of the already-open repo.
 */
const userPrompt = (dir: string): string =>
    `can we create new new site with react and nodejs put it here ${dir} keep code clean add rules and skeels`;

const approve = async (page: Page): Promise<void> => {
    const button = page.locator('#ingot-approval-run');
    await expect(button).toBeVisible({ timeout: 60_000 });
    await button.click();
};

test.describe('library prompt from real use', () => {
    test.setTimeout(420_000);
    let home: string;
    let dir: string;
    let server: FakeOllama;

    test.beforeEach(async () => {
        home = makeToolsProject('ingot-site-home-');
        dir = fs.realpathSync(fs.mkdtempSync(path.join(path.dirname(home), 'ingot-site-')));
        fs.rmdirSync(dir);
        server = await startFakeOllama((_system, user) => {
            // Repeat the request. That is the failure: no tool call, just the prompt again.
            if (user.includes('nodejs') && user.includes('put it here') && user.includes('skeels')) {
                return user;
            }
            if (user.includes('The new project is on disk')) {
                return `<<<TOOL ingot/run\n${JSON.stringify({ command: 'npm install && npm test && npm run build', cwd: dir })}\n>>>END\n`;
            }
            if (user.startsWith('Tool result (ingot/run)') && user.includes('exit 0') && !user.includes('feature/library') && !user.includes('Exit code 0')) {
                return `<<<TOOL ingot/ask_user\n${JSON.stringify({ question: 'Initialize a git repository on branch feature/library and make the first commit?', options: ['Yes, init and commit', 'Not now'] })}\n>>>END\n`;
            }
            // The tool card shows "exit 0"; the model still receives "Exit code 0."
            if (user.startsWith('Tool result (ingot/run)') && user.includes('Exit code 0') && !user.includes('feature/library')) {
                return `<<<TOOL ingot/ask_user\n${JSON.stringify({ question: 'Initialize a git repository on branch feature/library and make the first commit?', options: ['Yes, init and commit', 'Not now'] })}\n>>>END\n`;
            }
            if (user.startsWith('Tool result (ingot/ask_user)') && user.includes('Yes, init and commit')) {
                const command = "git init -b feature/library && git add . && git -c user.email=ingot-e2e@example.com -c user.name='Ingot E2E' commit -m 'Initial library app'";
                return `<<<TOOL ingot/run\n${JSON.stringify({ command, cwd: dir })}\n>>>END\n`;
            }
            if (user.startsWith('Tool result (ingot/run)') && user.includes('feature/library')) {
                return `<<<TOOL ingot/open_workspace\n${JSON.stringify({ path: dir })}\n>>>END\n`;
            }
            return 'The new site is ready.';
        }, { delayMs: 0 });
    });

    test.afterEach(async () => {
        await server.close();
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('creates the site at the given path instead of summarizing the open repo', async ({ page }) => {
        await openIngot(page, home);
        await dismissNotifications(page);
        await setAppearance(page, 'light');
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await page.locator('#ingot-composer-input').fill(userPrompt(dir));
        await page.locator('#ingot-composer-input').press('Enter');

        const chat = page.locator('#ingot-agents');
        await expect(page.locator('#ingot-review-files [data-path="AGENTS.md"]')).toBeVisible({ timeout: 60_000 });
        await expect(page.locator('#ingot-review-files [data-path=".ingot/skills/clean-library/SKILL.md"]')).toBeVisible();
        await expect(page.locator('#ingot-review-files [data-path="client/src/features/books/Books.tsx"]')).toBeVisible();
        await expect(page.locator('#ingot-review-files [data-path="server/src/app.test.ts"]')).toBeVisible();
        await expect(chat).toContainText('Template, not the agent');
        await expect(chat).not.toContainText('read from the open folder');
        await expect(chat).not.toContainText('This is **tools-project**');
        expect(fs.existsSync(path.join(dir, 'AGENTS.md'))).toBe(true);
        expect(fs.existsSync(path.join(dir, '.ingot', 'skills', 'clean-library', 'SKILL.md'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'client', 'src', 'features', 'books', 'Books.tsx'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'server', 'src', 'controllers', 'library-controller.ts'))).toBe(true);

        await approve(page);
        await expect(chat).toContainText('exit 0', { timeout: 240_000 });
        await expect(chat).not.toContainText('read from the open folder');
        await page.locator('#ingot-ask .ingot-ask-option', { hasText: 'Yes, init and commit' }).click();
        await approve(page);
        await expect(page.locator('#ingot-approval-line')).toContainText('Open folder', { timeout: 60_000 });
        await approve(page);
        await expect(page.locator(SHELL_SELECTOR)).toBeVisible({ timeout: 120_000 });
        await expect(page.locator('#files')).toContainText('client', { timeout: 60_000 });
        await expect(page.locator('#files')).toContainText('server');
        execFileSync('npm', ['test'], { cwd: dir, stdio: 'pipe' });
        expect(fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8')).toContain('feature/library');
    });
});
