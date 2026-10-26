import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { launchDesktop, type DesktopApp } from '../src/electron.utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/** IDEA-109: the approval card (Skip / Always Run / Run ⏎) for agent git actions and terminal commands, with a mock model. */
const SHOTS = process.env.INGOT_SHOTS;
const shot = async (page: Page, name: string): Promise<void> => {
    if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, name) });
    }
};
const tool = (name: string, args: Record<string, unknown>): string => `On it.\n\n<<<TOOL ingot/${name}\n${JSON.stringify(args)}\n>>>END\n`;

test.describe('IDEA-109 approval card (desktop)', () => {
    test.setTimeout(180_000);
    let dir: string;
    let desktop: DesktopApp;
    let server: FakeOllama;

    const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });
    const commits = (): string[] => git('log', '--format=%s').trim().split('\n').filter(Boolean);

    const start = async (settings: Record<string, unknown>, reply: (system: string, user: string) => string): Promise<Page> => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-approval-')));
        git('init', '-q', '-b', 'main');
        git('config', 'user.name', 'Ingot E2E');
        git('config', 'user.email', 'e2e@ingot.dev');
        fs.writeFileSync(path.join(dir, 'notes.md'), '# Notes\n');
        git('add', '.');
        git('commit', '-qm', 'Initial');
        server = await startFakeOllama(reply, { delayMs: 0 });
        desktop = await launchDesktop(dir, {}, settings);
        const { page } = desktop;
        await connectOllama(page, server);
        if (!await page.locator('#ingot-composer-input').isVisible()) {
            await page.locator('#ingot-rs-agents').click();
        }
        await pickModel(page, 'ollama-local');
        return page;
    };
    const ask = async (page: Page, text: string): Promise<void> => {
        await page.locator('#ingot-composer-input').click();
        await page.keyboard.type(text);
        await page.keyboard.press('Enter');
    };
    /** Each prompt "commit <n>" stages notes and commits "Note <n>"; a tool result ends the turn. */
    const committer = (_system: string, user: string): string => {
        if (user.startsWith('Tool result (ingot/git)')) {
            return user.includes('skipped') ? 'Okay, not committing.' : 'Committed.';
        }
        const n = /commit (\d+)/.exec(user)?.[1] ?? '0';
        return tool('git', { op: 'commit', message: `Note ${n}`, paths: ['notes.md'] });
    };
    const edit = (n: number): void => fs.appendFileSync(path.join(dir, 'notes.md'), `- note ${n}\n`);

    test.afterEach(async () => {
        await desktop?.close();
        await server?.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('Run: the card shows "Git commit: <message>", Enter runs it and the agent gets the result', async () => {
        const page = await start({ 'ingot.appearance': 'dark' }, committer);
        edit(1);
        await ask(page, 'commit 1 @notes.md');
        const card = page.locator('#ingot-approval');
        await expect(card).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('#ingot-approval-line')).toHaveText('Git commit: Note 1');
        await expect(page.locator('#ingot-approval-activity')).toHaveText('Exploring 1 file');
        await expect(page.locator('#ingot-approval-skip')).toHaveText('Skip');
        await expect(page.locator('#ingot-approval-always')).toHaveText('Always Run');
        await expect(page.locator('#ingot-approval-run')).toHaveText('Run ⏎');
        expect(commits()).toEqual(['Initial']);
        await shot(page, 'idea-109-card-dark.png');
        await page.keyboard.press('Enter');
        await expect(card).toHaveCount(0);
        await expect(page.locator('.ingot-agents-chat')).toContainText('Committed.', { timeout: 30_000 });
        expect(commits()).toEqual(['Note 1', 'Initial']);
    });

    test('Skip: Esc (with a note typed) skips, nothing runs and the reason goes back to the agent', async () => {
        const page = await start({ 'ingot.appearance': 'light' }, (_system, user) => user.startsWith('Tool result (ingot/run)')
            ? (user.includes('Reason: not now') ? 'Understood, skipped.' : 'Ran it.')
            : tool('run', { command: 'echo hi > out.txt' }));
        await ask(page, 'Write the out file');
        await expect(page.locator('#ingot-approval-line')).toHaveText('Run command: echo hi > out.txt', { timeout: 30_000 });
        await shot(page, 'idea-109-card-light.png');
        await page.locator('#ingot-composer-input').click();
        await page.keyboard.type('not now');
        await expect(page.locator('.ingot-approval-note')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#ingot-approval')).toHaveCount(0);
        await expect(page.locator('.ingot-agents-chat')).toContainText('Understood, skipped.', { timeout: 30_000 });
        expect(fs.existsSync(path.join(dir, 'out.txt'))).toBe(false);
        expect(server.requests.some(r => r.user.includes('The user skipped this action (Run command: echo hi > out.txt)'))).toBe(true);

        // Run on the button: the command runs in the project root.
        await ask(page, 'Write the out file again');
        await page.locator('#ingot-approval-run').click({ timeout: 30_000 });
        await expect(page.locator('.ingot-agents-chat')).toContainText('Ran it.', { timeout: 30_000 });
        expect(fs.readFileSync(path.join(dir, 'out.txt'), 'utf8').trim()).toBe('hi');
    });

    test('Always Run persists per project and action type, and Settings › Agent approvals revokes it', async () => {
        const page = await start({ 'ingot.appearance': 'dark' }, committer);
        edit(1);
        await ask(page, 'commit 1');
        await page.locator('#ingot-approval-always').click({ timeout: 30_000 });
        await expect(page.locator('.ingot-agents-chat')).toContainText('Committed.', { timeout: 30_000 });
        expect(commits()[0]).toBe('Note 1');

        // The next git action runs without the card.
        edit(2);
        await ask(page, 'commit 2');
        await expect.poll(commits, { timeout: 30_000 }).toEqual(['Note 2', 'Note 1', 'Initial']);
        await expect(page.locator('#ingot-approval')).toHaveCount(0);

        // Settings › Agent approvals lists it; Revoke brings the card back.
        await page.keyboard.press('Meta+,');
        await page.locator('#ingot-settings-node-agent-approvals').click();
        const row = page.locator('.ingot-always-run-row[data-kind="git"]');
        await expect(row).toContainText('Git actions');
        await expect(row).toContainText(dir);
        await shot(page, 'idea-109-settings-dark.png');
        await row.locator('.ingot-always-run-revoke').click();
        await expect(page.locator('#ingot-always-run-empty')).toBeVisible();
        await page.locator('#ingot-settings-ok').click();

        edit(3);
        await ask(page, 'commit 3');
        await expect(page.locator('#ingot-approval-line')).toHaveText('Git commit: Note 3', { timeout: 30_000 });
        await page.locator('#ingot-approval-skip').click();
        await expect(page.locator('.ingot-agents-chat')).toContainText('Okay, not committing.', { timeout: 30_000 });
        expect(commits()[0]).toBe('Note 2');
    });

    test('ingot.agent.git.requireApproval off: git actions run without the card', async () => {
        const page = await start({ 'ingot.agent.git.requireApproval': false }, committer);
        edit(1);
        await ask(page, 'commit 1');
        await expect.poll(commits, { timeout: 30_000 }).toEqual(['Note 1', 'Initial']);
        await expect(page.locator('#ingot-approval')).toHaveCount(0);
    });
});
