import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { makeToolsProject, setAppearance } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { TOOL_WINDOW_MOD } from '../src/e2e.consts';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/** IDEA-268: multi-file review with per-hunk decisions, parallel threads with a git worktree, live reload from disk. */
const SHOTS = path.resolve(__dirname, '..', '..', '.ingot-tmp', 'shots');
const A_BEFORE = ['const a1 = 1;', 'const a2 = 2;', 'const a3 = 3;', 'const a4 = 4;', 'const a5 = 5;', 'const a6 = 6;', 'const a7 = 7;', 'const a8 = 8;', ''].join('\n');
const A_AFTER = A_BEFORE.replace('const a2 = 2;', 'const a2 = 20;').replace('const a7 = 7;', 'const a7 = 70;');
const B_BEFORE = 'export const b = 1;\n';
const B_AFTER = 'export const b = 2;\n';
const NOTES = '# Notes from the worktree thread';

const notifications = (page: Page): Locator => page.locator('.theia-notification-list-item');
const toast = (page: Page, text: string | RegExp): Locator => notifications(page).filter({ hasText: text, visible: true }).first();

/** Toasts with a timeout can hide on their own while being closed, so the click may miss. */
const closeToast = async (page: Page, text: string): Promise<void> => {
    await toast(page, text).locator('.codicon-close').click({ timeout: 2_000 }).catch(() => undefined);
    await expect(toast(page, text)).toBeHidden();
};

const capture = async (target: Locator, name: string): Promise<void> => {
    fs.mkdirSync(SHOTS, { recursive: true });
    await target.screenshot({ path: path.join(SHOTS, name), animations: 'disabled' });
};

const git = (cwd: string, ...args: string[]): string =>
    execFileSync('git', ['-c', 'user.name=Ingot E2E', '-c', 'user.email=e2e@ingot.invalid', ...args], { cwd, encoding: 'utf8' });

/** Agent edits stay in review (auto-accept off), so the Review tab has something to decide. */
const reviewMode = async (page: Page): Promise<void> => {
    const dialog = page.locator('#ingot-settings');
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), dialog);
    await page.locator('#ingot-settings-node-agent-review').click();
    const autoAccept = page.locator('#ingot-setting-ingot-agent-review-autoAccept');
    if (await autoAccept.isChecked()) {
        await autoAccept.click();
    }
    const reviewOn = page.locator('#ingot-setting-ingot-agent-review-enabled');
    if (await reviewOn.count() && !await reviewOn.isChecked()) {
        await reviewOn.click();
    }
    await page.locator('#ingot-settings-ok').click();
    await expect(dialog).toBeHidden();
};

const send = async (page: Page, text: string): Promise<void> => {
    await pickModel(page, 'ollama-local');
    await page.locator('#ingot-composer-input').fill(text);
    await page.locator('#ingot-composer-input').press('Enter');
};

const openFromTree = async (page: Page, folder: string, name: string): Promise<void> => {
    await page.locator('#files').click();
    const file = page.locator('#files .theia-TreeNode', { hasText: name }).first();
    if (!await file.isVisible()) {
        await page.locator('#files .theia-TreeNode', { hasText: folder }).first().click();
    }
    await file.dblclick();
};

test.describe('IDEA-268 review, threads and live reload', () => {
    test.setTimeout(180_000);
    let home: string;
    let server: FakeOllama | undefined;

    test.afterEach(async () => {
        await server?.close();
        server = undefined;
        fs.rmSync(home, { recursive: true, force: true });
        fs.rmSync(`${home}.worktrees`, { recursive: true, force: true });
    });

    test('Review shows every changed file side by side with per-hunk accept / reject and an editable right side', async ({ page }) => {
        home = makeToolsProject('ingot-review-');
        fs.mkdirSync(path.join(home, 'src'));
        fs.writeFileSync(path.join(home, 'src', 'a.ts'), A_BEFORE);
        fs.writeFileSync(path.join(home, 'src', 'b.ts'), B_BEFORE);
        server = await startFakeOllama(() => [
            'PLAN:', '- Bump the numbers', 'Done.',
            '<<<EDIT src/a.ts', A_AFTER.trimEnd(), '>>>END',
            '<<<EDIT src/b.ts', B_AFTER.trimEnd(), '>>>END'
        ].join('\n'), { delayMs: 0 });
        await openIngot(page, home);
        await dismissNotifications(page);
        await setAppearance(page, 'light');
        await connectOllama(page, server);
        await reviewMode(page);
        await page.locator('#ingot-agents-new').click();
        await send(page, 'Bump the numbers');
        await expect(page.locator('#ingot-changes-summary')).toContainText('Edited 2 files', { timeout: 30_000 });

        await page.locator('#ingot-review-open').click();
        const review = page.locator('.ingot-agent-review');
        await expect(page.locator('#shell-tab-ingot-agent-review')).toBeVisible();
        await expect(page.locator('#ingot-rv-totals')).toContainText('2 files');
        await expect(page.locator('#ingot-rv-totals')).toContainText('3 pending');
        const fileA = review.locator('.ingot-rv-file[data-path="src/a.ts"]');
        const fileB = review.locator('.ingot-rv-file[data-path="src/b.ts"]');
        await expect(fileA.locator('.ingot-rv-hunk-actions')).toHaveCount(2);
        await expect(fileB.locator('.ingot-rv-hunk-actions')).toHaveCount(1);
        await expect(fileA.locator('.editor.original .view-lines')).toContainText('const a2 = 2;');
        await expect(fileA.locator('.editor.modified .view-lines')).toContainText('const a2 = 20;');
        await capture(review, 'review-light.png');
        await setAppearance(page, 'dark');
        await capture(review, 'review-dark.png');

        await fileA.locator('.ingot-rv-hunk-reject').first().click();
        await expect(page.locator('#ingot-rv-totals')).toContainText('2 pending');
        await fileA.locator('.ingot-rv-hunk-accept').first().click();
        await expect(fileA.locator('.ingot-rv-state')).toHaveText('Partly accepted');
        await expect.poll(() => fs.readFileSync(path.join(home, 'src', 'a.ts'), 'utf8')).toBe(A_BEFORE.replace('const a7 = 7;', 'const a7 = 70;'));

        await fileB.locator('.editor.modified .view-lines').click();
        await page.keyboard.press('Control+End');
        await page.keyboard.type('// reviewed');
        await expect(fileB.locator('.editor.modified .view-lines')).toContainText('// reviewed');
        await page.locator('#ingot-rv-accept-all').click();
        await expect(page.locator('#ingot-rv-totals')).toContainText('0 pending');
        await expect.poll(() => fs.readFileSync(path.join(home, 'src', 'b.ts'), 'utf8')).toBe(`${B_AFTER}// reviewed`);
    });

    test('Threads run chats in parallel, notify when done and isolate a thread in a git worktree', async ({ page }) => {
        home = makeToolsProject('ingot-threads-');
        git(home, 'init', '-q', '-b', 'main');
        git(home, 'add', '-A');
        git(home, 'commit', '-q', '-m', 'init');
        server = await startFakeOllama((_system, user) => user.includes('notes')
            ? ['PLAN:', '- Write the notes', 'Notes written.', '<<<EDIT notes.md', NOTES, '>>>END'].join('\n')
            : `Thinking about it step by step. ${'All good here. '.repeat(40)}Done.`, { delayMs: 50, chunkSize: 4 });
        await openIngot(page, home);
        await dismissNotifications(page);
        await setAppearance(page, 'light');
        await connectOllama(page, server);
        await reviewMode(page);

        const list = page.locator('#ingot-threads-list');
        await actUntilVisible(() => page.keyboard.press(`${TOOL_WINDOW_MOD}+3`), list);
        await page.locator('#ingot-threads-new').click();
        await send(page, 'First thread');
        await page.locator('#ingot-threads-new').click();
        await send(page, 'Second thread');
        await expect(page.locator('#ingot-threads-running')).toHaveText('2 running');
        await expect(list.locator('.ingot-thread[data-state="running"]')).toHaveCount(2);
        await expect(list.locator('.ingot-threads-group')).toHaveAttribute('data-project', path.basename(home));
        await capture(page.locator('.ingot-threads'), 'threads-running-light.png');

        await expect(toast(page, '"First thread" finished.')).toBeVisible({ timeout: 60_000 });
        await expect(list.locator('.ingot-thread[data-state="done"]')).toHaveCount(2, { timeout: 60_000 });
        await expect(notifications(page).filter({ hasText: '"Second thread" finished.' })).toHaveCount(0);
        await expect(page.locator('#ingot-threads-running')).toHaveCount(0);
        const first = list.locator('.ingot-thread', { hasText: 'First thread' });
        await expect(first.locator('.ingot-thread-unseen')).toBeVisible();
        await first.click();
        await expect(first).toHaveClass(/active/);
        await expect(first.locator('.ingot-thread-unseen')).toHaveCount(0);
        await closeToast(page, '"First thread" finished.');

        await page.locator('#ingot-threads-new-worktree').click();
        await expect(toast(page, 'git worktree')).toBeVisible();
        await closeToast(page, 'git worktree');
        const worktrees = `${home}.worktrees`;
        await expect.poll(() => fs.existsSync(worktrees) ? fs.readdirSync(worktrees).length : 0).toBe(1);
        const folder = path.join(worktrees, fs.readdirSync(worktrees)[0]);
        expect(git(home, 'worktree', 'list')).toContain(folder);
        await expect(list.locator('.ingot-thread-branch')).toContainText('ingot/');
        await send(page, 'Write the notes');
        await expect(list.locator('.ingot-thread[data-state="review"]')).toHaveCount(1, { timeout: 60_000 });
        await setAppearance(page, 'dark');
        await capture(page.locator('.ingot-threads'), 'threads-dark.png');
        await page.locator('#ingot-changes-accept-all').click();
        await expect.poll(() => fs.existsSync(path.join(folder, 'notes.md')) ? fs.readFileSync(path.join(folder, 'notes.md'), 'utf8').trim() : '').toBe(NOTES);
        expect(fs.existsSync(path.join(home, 'notes.md'))).toBe(false);
        expect(git(folder, 'branch', '--show-current').trim()).toMatch(/^ingot\//);
    });

    test('Files changed on disk reload in a clean editor and ask before replacing unsaved edits', async ({ page }) => {
        home = makeToolsProject('ingot-live-');
        const file = path.join(home, 'src', 'live.ts');
        fs.mkdirSync(path.dirname(file));
        fs.writeFileSync(file, 'export const version = "one";\n');
        await openIngot(page, home);
        await dismissNotifications(page);
        await openFromTree(page, 'src', 'live.ts');
        const lines = page.locator('#theia-main-content-panel .monaco-editor .view-lines').first();
        await expect(lines).toContainText('version = "one"');

        fs.writeFileSync(file, 'export const version = "two";\n');
        await expect(lines).toContainText('version = "two"');

        await lines.click();
        await page.keyboard.press('Control+End');
        await page.keyboard.type('// mine');
        await expect(lines).toContainText('// mine');
        fs.writeFileSync(file, 'export const version = "three";\n');
        const ask = toast(page, 'live.ts changed on disk');
        await expect(ask).toBeVisible();
        await ask.getByText('Reload from Disk').click();
        await expect(lines).toContainText('version = "three"');
        await expect(lines).not.toContainText('// mine');
    });
});
