import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { git } from '../src/git-repo';
import { connectOllama } from '../src/models.e2e-utils';

/**
 * IDEA-267: auto-context chips (file, selection, git diff, memories) that the user can remove, memories in
 * `.ingot/memory` (moved from the IDEA-77 folder), an overview reply sent back to do the task, and follow-up buttons.
 */
const CART = [
    'export const TAX_RATE = 0.2;',
    'export const total = (prices: number[]): number =>',
    '    prices.reduce((sum, price) => sum + price, 0);',
    ''
].join('\n');
const OVERVIEW = [
    '## Project overview',
    'This project is a small cart library written in TypeScript.',
    '',
    '- `src/` - the cart code',
    '- `README.md` - docs',
    '- `package.json` - scripts',
    '',
    'Key features: totals and tax.'
].join('\n');
const DONE = 'Added `tax` to `total` in src/cart.ts and ran the tests.';
/** The Git extension reads a fresh repo late on a cold start. */
const GIT_READY_MS = 45_000;
const memoryFile = (kind: string, text: string): string => `---\nscope: project\nkind: ${kind}\ncreated: 2026-10-01T00:00:00.000Z\n---\n${text}\n`;

const agents = (page: Page) => page.locator('#ingot-agents');
const chip = (page: Page, kind: string) => page.locator(`#ingot-auto-chip-${kind}`);

const makeRepo = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-context-')));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'cart.ts'), CART);
    git(dir, 'init', '-q');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'Init');
    fs.appendFileSync(path.join(dir, 'src', 'cart.ts'), '// TODO: tax\n');
    // An IDEA-77 memory folder: moved to `.ingot/memory` on first read.
    fs.mkdirSync(path.join(dir, '.ingot', 'memories'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.ingot', 'memories', 'm-old-fact.md'), memoryFile('fact', 'Prices are numbers in euros.'));
    fs.writeFileSync(path.join(dir, '.ingot', 'memories', 'm-old-pref.md'), memoryFile('preference', 'Keep replies short.'));
    return dir;
};

const reply = (_system: string, user: string): string => {
    if (user.startsWith('You described the repository')) {
        return `${DONE}\nNEXT: Add a test for tax | Commit the change`;
    }
    if (user.includes('Add a tax line')) {
        return OVERVIEW;
    }
    if (user.includes('Add a test for tax')) {
        return 'Added the test.\nNEXT: Run the tests';
    }
    return `Echo: ${user.slice(0, 40)}`;
};

test.describe('IDEA-267 agent context, memory and follow-ups', () => {
    let repo = '';
    let server: FakeOllama | undefined;

    test.afterEach(async () => {
        await server?.close();
        if (repo) {
            fs.rmSync(repo, { recursive: true, force: true });
        }
    });

    test('attaches removable IDE context, redirects an overview to the task, and offers follow-ups', async ({ page }) => {
        repo = makeRepo();
        server = await startFakeOllama(reply, { delayMs: 0, chunkSize: 4_000 });
        await openIngot(page, repo);
        await dismissNotifications(page);
        await setAppearance(page, 'light');
        await connectOllama(page, server);

        await expect(async () => {
            await page.keyboard.press('Escape');
            await page.keyboard.press('Control+p');
            await page.locator('.quick-input-widget input').fill('cart.ts');
            await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'cart.ts' }).first().click({ timeout: 3_000 });
            await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('TAX_RATE', { timeout: 3_000 });
        }).toPass({ timeout: 40_000 });
        await page.locator('.monaco-editor .view-line', { hasText: 'export const total' }).first().click();
        await page.keyboard.press('Home');
        await page.keyboard.press('Shift+ArrowDown');
        await page.keyboard.press('Shift+ArrowDown');

        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await expect(chip(page, 'file')).toContainText('cart.ts');
        await expect(chip(page, 'selection')).toContainText('cart.ts (2-3)');
        await expect(chip(page, 'diff')).toContainText('Git diff +1 −0', { timeout: GIT_READY_MS });
        await expect(chip(page, 'memory')).toContainText('2 memories');
        expect(fs.existsSync(path.join(repo, '.ingot', 'memory', 'm-old-fact.md'))).toBe(true);
        expect(fs.existsSync(path.join(repo, '.ingot', 'memories'))).toBe(false);
        await shot(page, 'auto-context-chips-light.png');

        // Remove the diff; it stays out of the next request, and Restore is offered.
        await chip(page, 'diff').getByRole('button', { name: /Remove Git diff/ }).click();
        await expect(chip(page, 'diff')).toHaveCount(0);
        await expect(page.locator('#ingot-auto-context-restore')).toBeVisible();

        await page.locator('#ingot-composer-input').fill('Add a tax line to the cart total');
        await page.locator('#ingot-composer-input').press('Enter');
        const lastReply = agents(page).locator('.ingot-chat-agent .ingot-md').last();
        await expect(lastReply).toContainText('Added tax to total');
        await expect(agents(page).locator('.ingot-chat-agent')).not.toContainText('Project overview');
        await expect(agents(page).locator('.ingot-chat-user').last().locator('.ingot-chat-auto')).toContainText('cart.ts (2-3)');

        const agentRequests = server.requests.filter(r => r.system.includes('How you work on every request'));
        const first = agentRequests[0];
        expect(first.user).toContain('Add a tax line');
        expect(first.system).toContain('IDE context (attached automatically');
        expect(first.system).toContain('Current file: src/cart.ts');
        expect(first.system).toContain('Selected in src/cart.ts (lines 2-3)');
        expect(first.system).not.toContain('Uncommitted changes');
        expect(first.system).toContain('User preferences (follow them):\n- Keep replies short.');
        expect(first.system).toContain('Repo facts remembered from earlier chats:\n- Prices are numbers in euros.');
        expect(first.system).toContain('How you work on every request');
        expect(first.system).toContain('NEXT:');
        expect(agentRequests[1].user).toMatch(/^You described the repository/);

        const followUps = page.locator('#ingot-follow-ups');
        await expect(followUps.locator('.ingot-follow-up')).toHaveText(['Add a test for tax', 'Commit the change']);
        await expect(lastReply).not.toContainText('NEXT:');
        await setAppearance(page, 'dark');
        await shot(page, 'follow-ups-dark.png');
        await page.locator('#ingot-follow-up-0').click();
        await expect(agents(page).locator('.ingot-chat-user').last()).toContainText('Add a test for tax');
        await expect(lastReply).toContainText('Added the test.');
        await expect(followUps.locator('.ingot-follow-up')).toHaveText(['Run the tests']);
        expect(server.requests.filter(r => r.user.includes('Add a test for tax')).at(-1)?.system).toContain('Current file: src/cart.ts');

        // Memories: the chip opens the manager; kinds are shown and can be picked.
        await chip(page, 'memory').locator('.ingot-auto-chip-label').click();
        const manager = page.locator('#ingot-memories');
        await expect(manager.locator('.ingot-memory-kind-preference')).toHaveText('Preference');
        await expect(manager.locator('.ingot-memory-kind-fact')).toHaveText('Repo fact');
        await manager.locator('#ingot-memories-add').click();
        await manager.locator('#ingot-memory-text').fill('Use tabs for indentation.');
        await manager.locator('#ingot-memory-kind').selectOption('preference');
        await manager.locator('#ingot-memory-scope').selectOption('project');
        await manager.locator('#ingot-memory-save').click();
        await expect(manager.locator('.ingot-memory-row', { hasText: 'Use tabs' }).locator('.ingot-memory-kind')).toHaveText('Preference');
        const saved = fs.readdirSync(path.join(repo, '.ingot', 'memory')).filter(f => f.endsWith('.md'));
        expect(saved).toHaveLength(3);
        await shot(page, 'memories-dark.png');
        await setAppearance(page, 'light');
    });
});
