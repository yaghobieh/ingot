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

/** A scripted model creates a library, runs its tests, offers git, and opens the folder. */
const SHOTS = '/opt/cursor/artifacts/screenshots';
const OPTIONS = [
    'React feature-folders, Node layered',
    'React feature-folders, Node modular',
    'React atomic, Node layered',
    'React atomic, Node modular'
];
const PROMPT = 'Create for me a new React and Node.js project with full APIs for a library, use structure X for React and Node.js structure Y, open it at path';

const save = async (page: Page, name: string): Promise<void> => {
    fs.mkdirSync(SHOTS, { recursive: true });
    await page.screenshot({ path: path.join(SHOTS, name) });
};

const both = async (page: Page, name: string): Promise<void> => {
    await setAppearance(page, 'light');
    await expect(page.locator('body')).toHaveClass(/ingot-light/);
    await save(page, `${name}-light.png`);
    await setAppearance(page, 'dark');
    await expect(page.locator('body')).toHaveClass(/ingot-dark/);
    await save(page, `${name}-dark.png`);
    await setAppearance(page, 'light');
};

const approve = async (page: Page): Promise<void> => {
    const button = page.locator('#ingot-approval-run');
    await expect(button).toBeVisible({ timeout: 60_000 });
    await button.click();
};

test.describe('library project from the agent', () => {
    test.setTimeout(420_000);
    let home: string;
    let dir: string;
    let server: FakeOllama;

    test.beforeEach(async () => {
        home = makeToolsProject('ingot-library-home-');
        dir = fs.realpathSync(fs.mkdtempSync(path.join(path.dirname(home), 'ingot-library-')));
        fs.rmdirSync(dir);
        server = await startFakeOllama((_system, user) => {
            if (user.includes('structure X') && !user.includes('feature-folders')) {
                return `<<<TOOL ingot/ask_user\n${JSON.stringify({ question: 'Which structures should the library project use?', options: OPTIONS })}\n>>>END\n`;
            }
            if (user.startsWith('Tool result (ingot/ask_user)') && user.includes('feature-folders')) {
                return `<<<TOOL ingot/create_library\n${JSON.stringify({ path: dir, react: 'feature-folders', node: 'layered' })}\n>>>END\n`;
            }
            if (user.startsWith('Tool result (ingot/create_library)')) {
                return `<<<TOOL ingot/run\n${JSON.stringify({ command: 'npm install && npm test && npm run build', cwd: dir })}\n>>>END\n`;
            }
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
            return 'The library project is ready.';
        }, { delayMs: 0 });
    });

    test.afterEach(async () => {
        await server.close();
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('asks for the layout, scaffolds, tests, offers git, and opens the folder', async ({ page }) => {
        await openIngot(page, home);
        await dismissNotifications(page);
        await setAppearance(page, 'light');
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await page.locator('#ingot-composer-input').fill(`${PROMPT} ${dir}.`);
        await page.locator('#ingot-composer-input').press('Enter');

        const ask = page.locator('#ingot-ask');
        await expect(ask).toBeVisible({ timeout: 30_000 });
        await expect(ask.locator('#ingot-ask-question')).toContainText('Which structures');
        await both(page, 'library-ask');
        await ask.locator('.ingot-ask-option', { hasText: OPTIONS[0] }).click();

        await expect(page.locator('#ingot-changes-accept-all')).toBeVisible({ timeout: 60_000 });
        await expect(page.locator('#ingot-turn-activity')).toContainText('package.json');
        await expect(page.locator('#ingot-review-files [data-path="server/src/app.test.ts"]')).toBeVisible();
        await both(page, 'library-diffs');
        await approve(page);

        await expect(page.locator('#ingot-agents')).toContainText('exit 0', { timeout: 240_000 });
        await expect(page.locator('#ingot-turn-command-0')).toContainText('npm test');
        await expect(ask).toContainText('first commit');
        await both(page, 'library-tests');
        await ask.locator('.ingot-ask-option', { hasText: 'Yes, init and commit' }).click();
        await approve(page);

        await expect(page.locator('#ingot-approval-line')).toContainText('Open folder', { timeout: 60_000 });
        await approve(page);
        await expect(page.locator(SHELL_SELECTOR)).toBeVisible({ timeout: 120_000 });
        await expect(page.locator('#files')).toContainText('client', { timeout: 60_000 });
        await expect(page.locator('#files')).toContainText('server');
        await both(page, 'library-tree');

        expect(fs.existsSync(path.join(dir, 'client', 'src', 'features', 'books', 'Books.tsx'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'server', 'src', 'controllers', 'library-controller.ts'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'server', 'src', 'app.test.ts'))).toBe(true);
        expect(fs.readFileSync(path.join(dir, '.git', 'HEAD'), 'utf8')).toContain('feature/library');
        execFileSync('npm', ['test'], { cwd: dir, stdio: 'pipe' });
        const log = execFileSync('git', ['log', '-1', '--format=%s'], { cwd: dir, encoding: 'utf8' });
        expect(log.trim()).toBe('Initial library app');
    });
});
