import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';

/**
 * IDEA-182: Settings › Tools › AI & Zaprex groups the agent defaults, Harmony mode, subagents, the Zaprex button,
 * Commit with AI and agent git hooks; the toggles take effect right away.
 */
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });
const makeRepo = (): string => {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-aiz-')));
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'e2e@ingot.dev');
    git(repo, 'config', 'user.name', 'E2E Bot');
    fs.writeFileSync(path.join(repo, 'cart.ts'), 'export const total = 1;\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'Init');
    fs.writeFileSync(path.join(repo, 'cart.ts'), 'export const total = 2;\n');
    return repo;
};

const dialog = (page: Page) => page.locator('#ingot-settings');
const setting = (page: Page, key: string) => page.locator(`#ingot-setting-${key.replace(/\./g, '-')}`);
const openAiSettings = async (page: Page): Promise<void> => {
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), dialog(page));
    await page.locator('#ingot-settings-search').fill('');
    await page.locator('#ingot-settings-node-ai-zaprex').click();
    await expect(page.locator('#ingot-settings-crumbs')).toHaveText('Tools › AI & Zaprex');
};

const KEYS = [
    'ingot.agent.defaultMode', 'ingot.agent.defaultModel',
    'ingot.zaprex.harmony.enabled', 'ingot.zaprex.harmony.maxPieces', 'ingot.zaprex.harmony.askFirst',
    'ingot.agents.subagents.view', 'ingot.zaprex.showButton', 'ingot.commit.ai.enabled',
    'ingot.agent.hooks.enabled', 'ingot.agent.hooks.installGitHooks'
];
const GROUPS = ['Agent defaults', 'Harmony mode', 'Subagents & Zaprex', 'Commits', 'Agent git hooks'];

for (const scheme of ['light', 'dark'] as const) {
    test(`IDEA-182 AI & Zaprex settings (${scheme})`, async ({ page }) => {
        test.setTimeout(120_000);
        const repo = makeRepo();
        try {
            await openIngot(page, repo);
            await setAppearance(page, scheme);
            await dismissNotifications(page);
            await expect(page.locator('#ingot-tb-zaprex')).toBeVisible();
            await actUntilVisible(() => page.keyboard.press('Control+k'), page.locator('#ingot-commit-message'));
            await expect(page.locator('#ingot-commit-ai')).toBeVisible();

            await openAiSettings(page);
            for (const group of GROUPS) {
                await expect(dialog(page).locator('.ingot-settings-card-title', { hasText: group })).toBeVisible();
            }
            for (const key of KEYS) {
                await expect(setting(page, key), key).toBeVisible();
            }
            await expect(setting(page, 'ingot.agent.defaultMode')).toHaveValue('agent');
            await expect(setting(page, 'ingot.zaprex.showButton')).toBeChecked();
            await expect(setting(page, 'ingot.commit.ai.enabled')).toBeChecked();
            await shot(page, `ai-zaprex-settings-${scheme}.png`);

            // Turn the T-rex and Commit with AI off; new chats start in Plan.
            await setting(page, 'ingot.agent.defaultMode').selectOption('plan');
            await setting(page, 'ingot.zaprex.showButton').click();
            await setting(page, 'ingot.commit.ai.enabled').click();
            await page.locator('#ingot-settings-ok').click();
            await expect(dialog(page)).toBeHidden();
            await expect(page.locator('#ingot-tb-zaprex')).toHaveCount(0);
            await expect(page.locator('#ingot-commit-ai')).toHaveCount(0);
            await page.locator('#ingot-agents-new').click();
            await expect(page.locator('#ingot-composer-mode')).toHaveAttribute('data-mode', 'plan');
            await shot(page, `ai-zaprex-settings-off-${scheme}.png`);

            // And back on.
            await openAiSettings(page);
            await setting(page, 'ingot.agent.defaultMode').selectOption('agent');
            await setting(page, 'ingot.zaprex.showButton').click();
            await setting(page, 'ingot.commit.ai.enabled').click();
            await page.locator('#ingot-settings-ok').click();
            await expect(page.locator('#ingot-tb-zaprex')).toBeVisible();
            await expect(page.locator('#ingot-commit-ai')).toBeVisible();
        } finally {
            fs.rmSync(repo, { recursive: true, force: true });
        }
    });
}
