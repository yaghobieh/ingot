import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot, runCommand, signOutIfSignedIn } from '../src/app.utils';
import { startFakeIngotServer, type FakeIngotServer } from '../src/fake-ingot-server';

/** IDEA-176: floating Commit window (status bar, Local Changes toolbar, ⌥⇧⌘K) and Commit with AI (fake gateway, no real model calls). */
const SHOTS_DIR = process.env.INGOT_SHOTS_DIR;
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });

const makeRepo = (): { repo: string; base: string } => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-cw-')));
    const remote = path.join(base, 'remote.git');
    const repo = path.join(base, 'shop');
    git(base, 'init', '-q', '--bare', '-b', 'main', remote);
    fs.mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'e2e@ingot.dev');
    git(repo, 'config', 'user.name', 'E2E Bot');
    git(repo, 'remote', 'add', 'origin', `file://${remote}`);
    fs.writeFileSync(path.join(repo, 'cart.ts'), 'export const total = (items: number[]) => items.reduce((a, b) => a + b, 0);\n');
    fs.writeFileSync(path.join(repo, 'b.ts'), 'export const b = 1;\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'Init');
    git(repo, 'push', '-q', '-u', 'origin', 'main');
    fs.writeFileSync(path.join(repo, 'cart.ts'), 'export const total = (items: number[], qty = 1) => items.reduce((a, b) => a + b * qty, 0);\n');
    fs.writeFileSync(path.join(repo, 'b.ts'), 'export const b = 2;\n');
    fs.writeFileSync(path.join(repo, 'notes.md'), '# notes\n');
    return { repo, base };
};

const win = (page: Page) => page.locator('#ingot-commit-window');
const winRow = (page: Page, file: string) => win(page).locator(`.ingot-cw-row[data-path="${file}"]`);

const useScheme = async (page: Page, scheme: 'light' | 'dark', repo: string): Promise<void> => {
    await page.emulateMedia({ colorScheme: scheme });
    await openIngot(page, repo);
    await page.locator('#ingot-rs-theme').click();
    await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'System' }).first().click();
    await expect(page.locator('body')).toHaveClass(new RegExp(`ingot-${scheme}`));
    await dismissNotifications(page);
};

const signIn = async (page: Page): Promise<void> => {
    const popup = page.waitForEvent('popup');
    await runCommand(page, 'Account: Sign in to Ingot…');
    (await popup).close();
    await expect(page.locator('#status-bar-ingot-account-status')).toContainText('left');
};

const shot = async (page: Page, name: string, target = page.locator('body')): Promise<void> => {
    if (SHOTS_DIR) {
        fs.mkdirSync(SHOTS_DIR, { recursive: true });
        await page.mouse.move(0, 0);
        await target.screenshot({ path: path.join(SHOTS_DIR, `${name}.png`) });
    }
};

test.describe('IDEA-176 Commit window and Commit with AI', () => {
    let repo: string;
    let base: string;
    let server: FakeIngotServer;
    test.beforeEach(async () => {
        ({ repo, base } = makeRepo());
        server = await startFakeIngotServer();
    });
    test.afterEach(async ({ page }) => {
        await signOutIfSignedIn(page).catch(() => undefined);
        await server.close();
        fs.rmSync(base, { recursive: true, force: true });
    });

    for (const scheme of ['light', 'dark'] as const) {
        test(`pop-out window: stage / unstage, diff preview, AI message, Commit and Push (${scheme})`, async ({ page }) => {
            git(repo, 'checkout', '-q', '-b', 'feature/qty');
            await useScheme(page, scheme, repo);
            await signIn(page);

            // Status bar entry shows the change count and opens the window.
            const status = page.locator('#status-bar-ingot-status-commit-window');
            await expect(status).toContainText('3');
            await actUntilVisible(() => status.click(), win(page));
            await expect(win(page).locator('.ingot-cw-branch')).toHaveText('feature/qty');
            await expect(win(page).locator('#ingot-cw-staged .ingot-cw-row')).toHaveCount(2);
            await expect(win(page).locator('#ingot-cw-changes .ingot-cw-row')).toHaveCount(1); // unversioned notes.md starts unstaged

            // Unstage b.ts, preview cart.ts.
            await winRow(page, 'b.ts').hover();
            await winRow(page, 'b.ts').locator('.ingot-cw-stage').click();
            await expect(win(page).locator('#ingot-cw-staged .ingot-cw-row')).toHaveCount(1);
            await expect(win(page).locator('#ingot-cw-summary')).toHaveText('1 of 3 files staged');
            await winRow(page, 'cart.ts').click();
            await expect(win(page).locator('.ingot-cw-diff-path')).toHaveText('cart.ts');
            await expect(win(page).locator('.ingot-cw-add')).toContainText('qty = 1');
            await expect(win(page).locator('.ingot-cw-del')).toHaveCount(1);
            await winRow(page, 'notes.md').click();
            await expect(win(page).locator('.ingot-cw-add')).toContainText('# notes');
            await winRow(page, 'cart.ts').click();

            // Commit with AI: only the staged diff goes to the default Ingot model, streamed into the box, editable after.
            await expect(win(page).locator('#ingot-cw-commit')).toBeDisabled();
            await win(page).locator('#ingot-cw-ai').click();
            const message = win(page).locator('#ingot-cw-message');
            await expect(message).toHaveValue(/Gateway reply/);
            await expect(win(page).locator('#ingot-cw-ai .codicon-sparkle')).toBeVisible();
            const call = server.calls.at(-1)!;
            expect(call).toMatchObject({ model: 'ingot-fast', feature: 'commit_message', authorization: 'Bearer ingot_at_e2e_access' });
            const value = await message.inputValue();
            expect(value).toContain('cart.ts');
            expect(value).not.toContain('b.ts');
            await shot(page, `commit-window-ai-${scheme}`);
            await shot(page, `commit-window-ai-crop-${scheme}`, win(page));

            await message.fill('Add qty to cart total');
            await win(page).locator('#ingot-cw-commit-push').click();
            await expect.poll(() => git(repo, 'log', '-1', '--format=%s').trim()).toBe('Add qty to cart total');
            expect(git(repo, 'show', '--name-only', '--format=', 'HEAD').trim()).toBe('cart.ts');
            const push = page.locator('.ingot-push-dialog');
            await expect(push).toBeVisible();
            await push.locator('#ingot-push-button').click();
            await expect.poll(() => git(path.join(base, 'remote.git'), 'branch', '--list').trim()).toContain('feature/qty');
            await expect(win(page).locator('#ingot-cw-message')).toHaveValue('');

            // Escape closes; ⌥⇧⌘K (Ctrl+Alt+Shift+K) brings it back.
            await win(page).locator('#ingot-cw-message').press('Escape');
            await expect(win(page)).toHaveCount(0);
            await actUntilVisible(() => page.keyboard.press('Control+Alt+Shift+K'), win(page));
            await win(page).locator('#ingot-cw-close').click();
            await expect(win(page)).toHaveCount(0);
        });
    }

    for (const scheme of ['light', 'dark'] as const) test(`docked view: sparkle writes the message, Open in Window and Dock move between views (${scheme})`, async ({ page }) => {
        await useScheme(page, scheme, repo);
        await signIn(page);
        await actUntilVisible(() => page.keyboard.press('Control+k'), page.locator('#ingot-commit-message'));
        await expect(page.locator('.ingot-lc-file[data-path="cart.ts"]')).toBeVisible();
        await page.locator('#ingot-commit-ai').click();
        await expect(page.locator('#ingot-commit-message')).toHaveValue(/Gateway reply/);
        expect(server.calls.at(-1)).toMatchObject({ feature: 'commit_message' });
        await page.locator('#ingot-commit-message').fill('Tweak cart');
        await shot(page, `commit-docked-ai-${scheme}`);

        await page.locator('#ingot-lc-popout').click();
        await expect(win(page)).toBeVisible();
        // The window can be dragged by its title bar.
        const before = (await win(page).boundingBox())!;
        await page.mouse.move(before.x + 200, before.y + 18);
        await page.mouse.down();
        await page.mouse.move(before.x + 120, before.y + 60, { steps: 4 });
        await page.mouse.up();
        const after = (await win(page).boundingBox())!;
        expect(Math.round(after.x)).toBe(Math.round(before.x - 80));
        await win(page).locator('#ingot-cw-message').fill('From the window');
        await win(page).locator('#ingot-cw-dock').click();
        await expect(win(page)).toHaveCount(0);
        await expect(page.locator('#ingot-commit-message')).toHaveValue('Tweak cart');
    });

    test('signed out or offline: Commit with AI explains instead of failing', async ({ page }) => {
        await openIngot(page, repo);
        await dismissNotifications(page);
        await signOutIfSignedIn(page);
        await runCommand(page, 'Open Commit Window');
        await expect(win(page)).toBeVisible();
        await win(page).locator('#ingot-cw-message').fill('keep me');
        await win(page).locator('#ingot-cw-ai').click();
        // With no Ingot account (and no own model connected) the box explains what to do.
        await expect(win(page).locator('#ingot-cw-ai-error')).toContainText(/Sign in to use Commit with AI\.|No model is ready|Can't reach/);
        await expect(win(page).locator('#ingot-cw-message')).toHaveValue('keep me');
        await shot(page, 'commit-window-signed-out', win(page));

        // Signed in, then the gateway goes away: a friendly error, the typed message stays.
        await signIn(page);
        server.chatErrors.push({ status: 503, code: 'upstream_unavailable', message: 'TypeError: fetch failed' });
        await win(page).locator('#ingot-cw-ai').click();
        await expect(win(page).locator('#ingot-cw-ai-error')).toBeVisible();
        await expect(win(page).locator('#ingot-cw-ai-error')).not.toContainText('Sign in');
        await expect(win(page).locator('#ingot-cw-message')).toHaveValue('keep me');
        await win(page).locator('#ingot-cw-close').click();
    });
});
