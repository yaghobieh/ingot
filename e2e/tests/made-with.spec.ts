import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot, runCommand, signOutIfSignedIn } from '../src/app.utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeIngotServer, type FakeIngotServer } from '../src/fake-ingot-server';
import { startFakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/** IDEA-183: commits written by the agent or Commit with AI end with "Made with Ingot"; Settings › AI & Zaprex turns it off. */
const INGOT_TRAILER = 'Made with [Ingot](https://ingot-portal.vercel.app)';
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });
const lastMessage = (repo: string): string => git(repo, 'log', '-1', '--format=%B').trim();

const makeRepo = (): string => {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-madewith-')));
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'e2e@ingot.dev');
    git(repo, 'config', 'user.name', 'E2E Bot');
    fs.writeFileSync(path.join(repo, 'notes.md'), '# notes\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'Init');
    return repo;
};

const signIn = async (page: Page): Promise<void> => {
    const popup = page.waitForEvent('popup');
    await runCommand(page, 'Account: Sign in to Ingot…');
    (await popup).close();
    await expect(page.locator('#status-bar-ingot-account-status')).toContainText('left');
};

const setTrailer = async (page: Page, on: boolean): Promise<void> => {
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), page.locator('#ingot-settings'));
    await page.locator('#ingot-settings-node-ai-zaprex').click();
    const box = page.locator('#ingot-setting-ingot-commit-madeWithTrailer');
    await expect(box).toBeVisible();
    if (await box.isChecked() !== on) {
        await box.click();
    }
    await page.locator('#ingot-settings-ok').click();
    await expect(page.locator('#ingot-settings')).toBeHidden();
};

test.describe('IDEA-183 Made with trailer', () => {
    let repo: string;
    let server: FakeIngotServer;
    test.beforeEach(async () => {
        repo = makeRepo();
        server = await startFakeIngotServer();
    });
    test.afterEach(async ({ page }) => {
        await signOutIfSignedIn(page).catch(() => undefined);
        await server.close();
        fs.rmSync(repo, { recursive: true, force: true });
    });

    for (const scheme of ['light', 'dark'] as const) {
        test(`Commit with AI adds the trailer; off in settings, it does not (${scheme})`, async ({ page }) => {
            test.setTimeout(120_000);
            await openIngot(page, repo);
            await setAppearance(page, scheme);
            await dismissNotifications(page);
            await signIn(page);
            fs.appendFileSync(path.join(repo, 'notes.md'), '- one\n');
            await actUntilVisible(() => page.keyboard.press('Control+k'), page.locator('#ingot-commit-message'));
            await expect(page.locator('.ingot-lc-file[data-path="notes.md"]')).toBeVisible();
            await page.locator('#ingot-commit-ai').click();
            await expect(page.locator('#ingot-commit-message')).toHaveValue(/Gateway reply/);
            await shot(page, `made-with-ai-${scheme}.png`);
            await page.locator('#ingot-commit-button').click();
            await expect.poll(() => lastMessage(repo)).toContain(INGOT_TRAILER);
            expect(lastMessage(repo).split('\n').at(-1)).toBe(INGOT_TRAILER);

            // A message typed by hand never gets it.
            fs.appendFileSync(path.join(repo, 'notes.md'), '- two\n');
            await expect(page.locator('.ingot-lc-file[data-path="notes.md"]')).toBeVisible();
            await page.locator('#ingot-commit-message').fill('Hand written');
            await page.locator('#ingot-commit-button').click();
            await expect.poll(() => lastMessage(repo)).toBe('Hand written');

            // Turned off: Commit with AI commits the message as is.
            await setTrailer(page, false);
            fs.appendFileSync(path.join(repo, 'notes.md'), '- three\n');
            await expect(page.locator('.ingot-lc-file[data-path="notes.md"]')).toBeVisible();
            await page.locator('#ingot-commit-ai').click();
            await expect(page.locator('#ingot-commit-message')).toHaveValue(/Gateway reply/);
            await page.locator('#ingot-commit-button').click();
            await expect.poll(() => git(repo, 'rev-list', '--count', 'HEAD').trim()).toBe('4');
            expect(lastMessage(repo)).not.toContain('Made with');
            await setTrailer(page, true);
        });
    }

    test('agent commits end with Made with Ingot', async ({ page }) => {
        test.setTimeout(120_000);
        const ollama = await startFakeOllama((_system, user) => {
            if (user.startsWith('Tool result (ingot/git)')) {
                return 'Committed.';
            }
            return `On it.\n\n<<<TOOL ingot/git\n${JSON.stringify({ op: 'commit', message: 'Add a note', paths: ['notes.md'] })}\n>>>END\n`;
        }, { delayMs: 0 });
        try {
            await openIngot(page, repo);
            await dismissNotifications(page);
            await connectOllama(page, ollama);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            fs.appendFileSync(path.join(repo, 'notes.md'), '- agent\n');
            await page.locator('#ingot-composer-input').fill('commit the note');
            await page.locator('#ingot-composer-input').press('Enter');
            await page.locator('#ingot-approval-run').click();
            await expect.poll(() => lastMessage(repo), { timeout: 30_000 }).toBe(`Add a note\n\n${INGOT_TRAILER}`);
            await shot(page, 'made-with-agent-light.png');
        } finally {
            await ollama.close();
        }
    });
});
