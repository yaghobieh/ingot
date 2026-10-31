import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { E2E_CONFIG_DIR } from '../src/e2e.consts';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { startOpenPlanServer, type FakeIngotServer } from '../src/fake-ingot-server';
import { createTempRepo } from '../src/git-repo';
import { connectOllama } from '../src/models.e2e-utils';

/**
 * IDEA-287: `/bugbot #12` runs the AI review on a GitHub pull request (fake gh) with the BUGBOT.md guidelines, shows the
 * findings in the Review panel and posts them to the PR on request (or automatically with the preference on).
 */
const SETTINGS_FILE = path.join(E2E_CONFIG_DIR, 'settings.json');
const REMOTE_CONFIG_CACHE = path.join(E2E_CONFIG_DIR, 'remote-config.json');
const AUTO_POST = 'ingot.review.bugbot.postToGitHub';
const CODE_REVIEWER = 'senior code reviewer';
const PAY_FINDING = { path: 'src/pay.ts', line: 2, severity: 'high', title: 'total subtracts instead of adding', detail: 'Use a + b in the reducer.' };
const MATH_FINDING = { path: 'src/math.ts', line: 3, severity: 'medium', title: 'mul ignores its second argument', detail: 'Return a * b.' };

const readJson = (file: string): Record<string, unknown> => {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
        return {};
    }
};
const writeSettings = (patch: Record<string, unknown>): void =>
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...readJson(SETTINGS_FILE), ...patch }, undefined, 4));
const comments = (dir: string): { pr: string; body: string }[] => {
    const log = path.join(dir, 'fake-gh.log');
    return fs.existsSync(log) ? fs.readFileSync(log, 'utf8').trim().split('\n').map(line => JSON.parse(line) as { pr: string; body: string }) : [];
};

const composer = (page: Page): Locator => page.locator('#ingot-composer-input');
const agentReplies = (page: Page): Locator => page.locator('#ingot-agents .ingot-chat-agent');
const panel = (page: Page): Locator => page.locator('#ingot-code-review');

const send = async (page: Page, text: string): Promise<void> => {
    await composer(page).fill(text);
    await composer(page).press('Enter');
};

const shots = async (page: Page, name: string): Promise<void> => {
    await setAppearance(page, 'light');
    await shot(page, `${name}-light.png`);
    await setAppearance(page, 'dark');
    await shot(page, `${name}-dark.png`);
};

test.describe('IDEA-287 /bugbot reviews GitHub pull requests with the AI review', () => {
    test.setTimeout(240_000);
    let dir: string;
    let server: FakeOllama;
    let account: FakeIngotServer;

    test.beforeEach(async () => {
        dir = createTempRepo();
        account = await startOpenPlanServer();
        server = await startFakeOllama((system, user) => {
            if (system.includes(CODE_REVIEWER)) {
                return JSON.stringify([...(user.includes('src/pay.ts') ? [PAY_FINDING] : []), ...(user.includes('src/math.ts') ? [MATH_FINDING] : [])]);
            }
            return 'OK.';
        }, { delayMs: 0 });
    });

    test.afterEach(async ({ page }) => {
        await setAppearance(page, 'dark').catch(() => undefined);
        writeSettings({ [AUTO_POST]: false });
        await server.close();
        await account.close();
        fs.rmSync(REMOTE_CONFIG_CACHE, { force: true });
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const start = async (page: Page): Promise<void> => {
        await openIngot(page, dir);
        await expect.poll(() => account.configCalls.length).toBeGreaterThan(0);
        await dismissNotifications(page);
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
    };

    test('"/bugbot #12" reviews the PR with BUGBOT.md and "Post to GitHub PR" comments on it', async ({ page }) => {
        fs.mkdirSync(path.join(dir, '.ingot'), { recursive: true });
        fs.writeFileSync(path.join(dir, '.ingot', 'BUGBOT.md'), 'BUGBOT-MARKER: check every reducer operator.\n');
        await start(page);

        await send(page, '/bugbot #12');
        await expect(agentReplies(page).last()).toContainText('Bugbot found 1 issue in PR #12 (1 high)', { timeout: 60_000 });
        await expect(agentReplies(page).last()).toContainText('Post to GitHub PR');
        const review = server.requests.find(r => r.system.includes(CODE_REVIEWER));
        expect(review?.system).toContain('BUGBOT-MARKER');
        expect(review?.user).toContain('+    items.reduce((a, b) => a - b, 0);');
        await expect(panel(page).locator('#ingot-code-review-label')).toContainText('PR #12');
        await expect(panel(page).locator('.ingot-cr-finding[data-severity="high"]')).toContainText(PAY_FINDING.title);
        await shots(page, 'bugbot-pr-review');

        await panel(page).locator('#ingot-code-review-post').click();
        await expect(panel(page).locator('#ingot-code-review-posted')).toBeVisible({ timeout: 30_000 });
        await expect(page.locator('.theia-notification-list-item').filter({ hasText: 'Posted the review to the pull request' }).first()).toBeVisible();
        const posted = comments(dir);
        expect(posted).toHaveLength(1);
        expect(posted[0].pr).toBe('12');
        expect(posted[0].body).toContain('<!-- ingot-bugbot -->');
        expect(posted[0].body).toContain('| High | `src/pay.ts:2` | **total subtracts instead of adding** Use a + b in the reducer. |');
        await shots(page, 'bugbot-posted');
    });

    test('with auto-post on, "/bugbot pr 5" posts by itself; "/bugbot" alone reviews the local changes', async ({ page }) => {
        writeSettings({ [AUTO_POST]: true });
        fs.appendFileSync(path.join(dir, 'src', 'math.ts'), 'export const mul = (a: number, b: number): number => a;\n');
        await start(page);

        // Without a BUGBOT.md, /bugbot is a built-in of the / menu that waits for arguments.
        await composer(page).focus();
        await page.keyboard.type('/bugb');
        await expect(page.locator('#ingot-slash-menu')).toContainText('/bugbot');
        await page.keyboard.press('Enter');
        await expect(composer(page)).toHaveText(/^\/bugbot\s*$/);
        await page.keyboard.type('pr 5');
        await page.keyboard.press('Enter');
        await expect(agentReplies(page).last()).toContainText('Posted the review to the pull request: https://github.com/acme/shop/pull/5#issuecomment-1', { timeout: 60_000 });
        expect(comments(dir).map(c => c.pr)).toEqual(['5']);
        await expect(panel(page).locator('#ingot-code-review-posted')).toBeVisible();

        // "/bugbot" alone: Enter picks it from the / menu, the next Enter sends it.
        await send(page, '/bugbot');
        await expect(composer(page)).toHaveText(/^\/bugbot\s*$/);
        await composer(page).press('Enter');
        await expect(agentReplies(page).last()).toContainText('Bugbot found 1 issue in Local changes (1 medium)', { timeout: 60_000 });
        await expect(panel(page).locator('.ingot-cr-finding')).toContainText(MATH_FINDING.title);
        await expect(panel(page).locator('#ingot-code-review-post')).toHaveCount(0);
        expect(comments(dir)).toHaveLength(1);
    });
});
