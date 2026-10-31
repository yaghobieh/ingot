import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { setAppearance, shot, toolBlock } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { E2E_CONFIG_DIR } from '../src/e2e.consts';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { startOpenPlanServer, type FakeIngotServer } from '../src/fake-ingot-server';
import { createTempRepo, git } from '../src/git-repo';
import { connectOllama } from '../src/models.e2e-utils';

/**
 * IDEA-287 re-audit against the current Cursor docs: CLAUDE.md (root and nested) is read like AGENTS.md; skills in
 * `.agents/skills` and `.claude/skills` show in `/`; a `.cursor/agents` subagent runs through `ingot/task` (read-only,
 * its own instructions) in a worktree prepared by `.cursor/worktrees.json`; `.cursor/cli.json` and `.cursor/sandbox.json`
 * feed the agent policy.
 */
const REMOTE_CONFIG_CACHE = path.join(E2E_CONFIG_DIR, 'remote-config.json');
const REVIEWER = '---\nname: reviewer\ndescription: Reviews code for bugs\nreadonly: true\n---\nREVIEWER-INSTRUCTIONS-MARKER: report bugs, never change files.\n';

const write = (dir: string, file: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
};
const composer = (page: Page): Locator => page.locator('#ingot-composer-input');
const agentReplies = (page: Page): Locator => page.locator('#ingot-agents .ingot-chat-agent');
const block = (tool: string, args: Record<string, unknown>): string => `<<<TOOL ingot/${tool}\n${JSON.stringify(args)}\n>>>END\n`;

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

const worktrees = (dir: string): string[] =>
    git(dir, 'worktree', 'list', '--porcelain').split('\n').filter(l => l.startsWith('worktree ')).slice(1).map(l => l.slice('worktree '.length));

test.describe('IDEA-287 Cursor docs re-audit', () => {
    test.setTimeout(240_000);
    let dir: string;
    let server: FakeOllama;
    let account: FakeIngotServer;
    let reply: (system: string, user: string) => string;

    test.beforeEach(async () => {
        dir = createTempRepo();
        account = await startOpenPlanServer();
        reply = () => 'OK.';
        server = await startFakeOllama((system, user) => reply(system, user), { delayMs: 0 });
    });

    test.afterEach(async ({ page }) => {
        await setAppearance(page, 'dark').catch(() => undefined);
        await server.close();
        await account.close();
        fs.rmSync(REMOTE_CONFIG_CACHE, { force: true });
        for (const folder of worktrees(dir)) {
            execFileSync('git', ['worktree', 'remove', '--force', folder], { cwd: dir });
        }
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

    test('CLAUDE.md is read like AGENTS.md (root always, nested for its folder) and shared skill folders show in /', async ({ page }) => {
        write(dir, 'CLAUDE.md', 'ROOT-CLAUDE-MARKER: use pnpm.\n');
        write(dir, 'packages/api/CLAUDE.md', 'API-CLAUDE-MARKER: validate every request.\n');
        write(dir, 'packages/api/src/index.ts', 'export const api = 1;\n');
        write(dir, '.agents/skills/deploy/SKILL.md', '---\nname: deploy\ndescription: Deploy the app\n---\nDEPLOY-SKILL-MARKER\n');
        write(dir, '.claude/skills/lint-fix/SKILL.md', '---\nname: lint-fix\ndescription: Fix lint errors\n---\nLINT-SKILL-MARKER\n');
        reply = (_system, user) => {
            if (user.startsWith('Tool result (ingot/read_file)')) {
                return 'Read the API entry.';
            }
            return user.includes('read the api') ? toolBlock('read_file', { path: 'packages/api/src/index.ts' }) : 'Rules checked.';
        };
        await start(page);

        await send(page, 'read the api entry');
        await expect(agentReplies(page).last()).toContainText('Read the API entry.', { timeout: 60_000 });
        const first = server.requests.find(r => r.user.includes('read the api'))!;
        expect(first.system).toContain('ROOT-CLAUDE-MARKER');
        expect(first.system).not.toContain('API-CLAUDE-MARKER');
        await send(page, 'check rules again');
        await expect(agentReplies(page).last()).toContainText('Rules checked.', { timeout: 60_000 });
        expect(server.requests.find(r => r.user.includes('check rules again'))!.system).toContain('API-CLAUDE-MARKER');

        for (const theme of ['light', 'dark'] as const) {
            await setAppearance(page, theme);
            await composer(page).focus();
            await page.keyboard.type('/');
            const menu = page.locator('#ingot-slash-menu');
            await expect(menu).toContainText('/deploy');
            await expect(menu).toContainText('/lint-fix');
            await shot(page, `cursor-shared-skills-${theme}.png`);
            await page.keyboard.press('Escape');
            await composer(page).fill('');
        }
    });

    test('the agent is offered skills (category folders, paths, nested folders, not manual-only) and reads one with fetch_rule', async ({ page }) => {
        write(dir, '.cursor/skills/workflow/tdd/SKILL.md', '---\nname: tdd\ndescription: Test-driven workflow\n---\nTDD-SKILL-MARKER: write the failing test first.\n');
        write(dir, '.cursor/skills/release/SKILL.md', '---\nname: release\ndescription: Cut a release\ndisable-model-invocation: true\n---\nRELEASE-SKILL-MARKER\n');
        write(dir, '.agents/skills/react/SKILL.md', '---\nname: react\ndescription: React component patterns\npaths:\n  - "**/*.tsx"\n---\nREACT-SKILL-MARKER\n');
        write(dir, 'apps/web/.cursor/skills/deploy-web/SKILL.md', '---\nname: deploy-web\ndescription: Deploy the web app\n---\nDEPLOY-WEB-MARKER\n');
        write(dir, 'apps/web/src/App.tsx', 'export const App = () => null;\n');
        reply = (_system, user) => {
            if (user.startsWith('Tool result (ingot/fetch_rule)')) {
                return 'Following the tdd skill.';
            }
            if (user.startsWith('Tool result (ingot/read_file)')) {
                return 'Read the web app.';
            }
            if (user.includes('open the web app')) {
                return toolBlock('read_file', { path: 'apps/web/src/App.tsx' });
            }
            return user.includes('pick a workflow') ? toolBlock('fetch_rule', { name: 'tdd' }) : 'Skills checked.';
        };
        await start(page);

        await send(page, 'pick a workflow');
        await expect(agentReplies(page).filter({ hasText: 'Following the tdd skill.' })).toBeVisible({ timeout: 60_000 });
        const first = server.requests.find(r => r.user.includes('pick a workflow'))!;
        expect(first.system).toContain('Available skills');
        expect(first.system).toContain('- tdd: Test-driven workflow');
        expect(first.system).not.toContain('- release:');
        expect(first.system).not.toContain('- react:');
        expect(first.system).not.toContain('- deploy-web:');
        expect(server.requests.find(r => r.user.startsWith('Tool result (ingot/fetch_rule)'))!.user).toContain('TDD-SKILL-MARKER');
        await shots(page, 'cursor-skills-fetched');

        await send(page, 'open the web app');
        await expect(agentReplies(page).last()).toContainText('Read the web app.', { timeout: 60_000 });
        await send(page, 'check skills again');
        await expect(agentReplies(page).last()).toContainText('Skills checked.', { timeout: 60_000 });
        const later = server.requests.find(r => r.user.includes('check skills again'))!.system;
        expect(later).toContain('- react: React component patterns');
        expect(later).toContain('- deploy-web: Deploy the web app (for files under apps/web/)');
        expect(later).not.toContain('- release:');

        for (const theme of ['light', 'dark'] as const) {
            await setAppearance(page, theme);
            await composer(page).focus();
            await page.keyboard.type('/');
            const menu = page.locator('#ingot-slash-menu');
            for (const name of ['/tdd', '/release', '/react', '/deploy-web']) {
                await expect(menu).toContainText(name);
            }
            await shot(page, `cursor-skills-menu-${theme}.png`);
            await page.keyboard.press('Escape');
            await composer(page).fill('');
        }
    });

    test('a .cursor/agents subagent runs read-only with its instructions, in a worktree set up by .cursor/worktrees.json', async ({ page }) => {
        write(dir, '.cursor/agents/reviewer.md', REVIEWER);
        write(dir, '.cursor/worktrees.json', JSON.stringify({ 'setup-worktree': ['echo "$ROOT_WORKTREE_PATH" > setup-root.txt'] }));
        reply = (_system, user) => {
            if (user.startsWith('Tool result (ingot/task)')) {
                return 'The reviewer finished.';
            }
            if (user.startsWith('Tool result (ingot/run)')) {
                return 'Review done: no bugs found.';
            }
            if (user.includes('TASK-REVIEW')) {
                return toolBlock('run', { command: 'echo hacked > hacked.txt' });
            }
            return `Starting the reviewer.\n\n${block('task', { description: 'Review math', prompt: 'Review src/math.ts. TASK-REVIEW', subagent_type: 'reviewer', worktree: true })}`;
        };
        await start(page);
        await send(page, 'Review the math module');
        await expect(agentReplies(page).last()).toContainText('The reviewer finished.', { timeout: 90_000 });

        const lead = server.requests.find(r => r.user.includes('Review the math module'))!;
        expect(lead.system).toContain('Custom subagents');
        expect(lead.system).toContain('- reviewer (read-only): Reviews code for bugs');
        const child = server.requests.find(r => r.user.includes('TASK-REVIEW'))!;
        expect(child.user).toContain('Your instructions as the subagent "reviewer":\nREVIEWER-INSTRUCTIONS-MARKER');
        expect(child.users).toHaveLength(1);
        expect(server.requests.some(r => r.user.startsWith('Tool result (ingot/run)') && r.user.includes('"reviewer" is a read-only subagent'))).toBe(true);

        const [folder] = worktrees(dir);
        expect(folder).toBeTruthy();
        expect(fs.readFileSync(path.join(folder, 'setup-root.txt'), 'utf8').trim()).toBe(dir);
        expect(fs.existsSync(path.join(folder, 'hacked.txt'))).toBe(false);
        expect(fs.existsSync(path.join(dir, 'hacked.txt'))).toBe(false);

        const manager = page.locator('#ingot-agent-manager');
        await actUntilVisible(() => page.keyboard.press('Control+Alt+Shift+M'), manager);
        const row = manager.locator('.ingot-am-row', { hasText: 'Review math' });
        await expect(row).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
        await expect(row.locator('.ingot-am-chip')).toContainText('ingot/task-');
        await shots(page, 'cursor-subagent-worktree');
    });

    test('.cursor/cli.json and .cursor/sandbox.json feed the agent policy and show in the audit log', async ({ page }) => {
        write(dir, '.cursor/cli.json', JSON.stringify({ version: 1, permissions: { allow: ['Shell(git:status)', 'Read(**)'], deny: ['Shell(rm)', 'Mcp(github:delete_repo)'] } }));
        write(dir, '.cursor/sandbox.json', JSON.stringify({ type: 'workspace_readwrite', networkPolicy: { default: 'allow', deny: ['pastebin.com'] } }));
        reply = (_system, user) => {
            if (user.startsWith('Tool result (ingot/run)')) {
                return 'Policy respected.';
            }
            return toolBlock('run', { command: 'rm -rf build' });
        };
        await start(page);
        await send(page, 'clean the build folder');
        await expect(agentReplies(page).last()).toContainText('Policy respected.', { timeout: 60_000 });
        expect(server.requests.some(r => r.user.startsWith('Tool result (ingot/run)') && r.user.includes('commands.deny "rm"'))).toBe(true);
        expect(server.requests.some(r => r.user.startsWith('Tool result (ingot/run)') && r.user.includes('Blocked by .cursor/cli.json'))).toBe(true);

        const audit = page.locator('#ingot-audit');
        await actUntilVisible(() => page.keyboard.press('Control+Alt+Shift+A'), audit);
        const policy = page.locator('#ingot-audit-policy');
        await expect(policy).toContainText('Policy from Cursor files');
        await expect(policy.locator('[data-source=".cursor/cli.json"]')).toBeVisible();
        await expect(policy.locator('[data-source=".cursor/sandbox.json"]')).toBeVisible();
        await expect(page.locator('#ingot-audit-policy-ignored')).toHaveText('Cursor entries not applied: 2');
        await page.locator('#ingot-audit-filter').fill(path.basename(dir));
        await expect(page.locator('#ingot-audit-table .ingot-audit-row').filter({ hasText: 'rm -rf build' })).toHaveAttribute('data-decision', 'denied');
        await shots(page, 'cursor-policy-audit');
    });
});
