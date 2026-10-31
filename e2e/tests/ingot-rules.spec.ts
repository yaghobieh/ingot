import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';

/**
 * IDEA-287 / 294 / 295 / 296: Cursor-style rule types (agent requested via ingot/fetch_rule, manual via @), nested
 * AGENTS.md, .ingotignore, hooks.json agent events, /init, the User Rules page and Habits.
 */
const GUARD = `let s = '';
process.stdin.on('data', d => { s += d; }).on('end', () => {
    const input = JSON.parse(s || '{}');
    const deny = /rm -rf/.test(input.command || '');
    process.stdout.write(JSON.stringify(deny ? { permission: 'deny', userMessage: 'Blocked by guard', agentMessage: 'HOOK-DENY-MARKER' } : { permission: 'allow' }));
});
`;

const write = (dir: string, file: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
};

const makeRulesProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-rules-')));
    write(dir, 'package.json', JSON.stringify({ name: 'rules-project', private: true, scripts: { lint: 'eslint .', test: 'vitest run' }, devDependencies: { typescript: '~5', vitest: '^2' } }, undefined, 2));
    write(dir, 'package-lock.json', '{}\n');
    write(dir, 'AGENTS.md', 'ROOT-AGENTS-MARKER\n');
    write(dir, '.ingot/rules/api-style.md', '---\ndescription: How to write API handlers\nalwaysApply: false\n---\nAPI-STYLE-MARKER: validate input with zod.\n');
    write(dir, '.ingot/rules/bear.md', '---\nalwaysApply: false\n---\nBEAR-MANUAL-MARKER: use Bear components.\n');
    write(dir, 'packages/web/AGENTS.md', 'WEB-AGENTS-MARKER\n');
    write(dir, 'packages/web/src/App.tsx', 'export const App = () => null;\n');
    write(dir, 'packages/api/AGENTS.md', 'API-AGENTS-MARKER\n');
    write(dir, 'packages/api/index.ts', 'export const api = 1;\n');
    write(dir, '.ingotignore', 'private/\n');
    write(dir, 'private/notes.txt', 'HIDDEN-FILE-MARKER\n');
    write(dir, '.ingot/hooks/guard.js', GUARD);
    write(dir, '.ingot/hooks.json', JSON.stringify({ version: 1, hooks: { beforeShellExecution: [{ command: 'node .ingot/hooks/guard.js', timeout: 10 }] } }, undefined, 2));
    return dir;
};

const composer = (page: Page) => page.locator('#ingot-composer-input');
const lastAnswer = (page: Page) => page.locator('#ingot-agents .ingot-chat-agent .ingot-md').last();

const newAgent = async (page: Page, server: FakeOllama): Promise<void> => {
    await connectOllama(page, server);
    await page.locator('#ingot-agents-new').click();
    await pickModel(page, 'ollama-local');
    await dismissNotifications(page);
};

const currentAppearance = async (page: Page): Promise<string> => {
    await openSettingsPage(page, 'appearance');
    const value = await page.locator('#ingot-setting-ingot-appearance').inputValue();
    await page.locator('#ingot-settings-cancel').click();
    return value;
};

const openSettingsPage = async (page: Page, id: string): Promise<void> => {
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), page.locator('#ingot-settings'));
    await page.locator(`#ingot-settings-node-${id}`).click();
};

test.describe('IDEA-287/294/295/296 .ingot rules, ignore, hooks, /init and Habits', () => {
    test.setTimeout(180_000);
    let dir: string;
    let server: FakeOllama;
    const systems: string[] = [];
    const users: string[] = [];

    test.beforeEach(async () => {
        dir = makeRulesProject();
        systems.length = 0;
        users.length = 0;
        server = await startFakeOllama((system, user) => {
            systems.push(system);
            users.push(user);
            if (user.startsWith('Tool result (ingot/fetch_rule)')) {
                return '<<<TOOL ingot/read_file\n{"path": "private/notes.txt"}\n>>>END';
            }
            if (user.startsWith('Tool result (ingot/read_file)')) {
                return '<<<TOOL ingot/run\n{"command": "rm -rf build"}\n>>>END';
            }
            if (user.startsWith('Tool result (ingot/')) {
                return 'All checked.';
            }
            if (user.includes('api handler')) {
                return 'Reading the API rule.\n\n<<<TOOL ingot/fetch_rule\n{"name": "api-style"}\n>>>END';
            }
            return 'Done.';
        }, { delayMs: 0 });
    });

    test.afterEach(async () => {
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('agent-requested rules via fetch_rule, nested AGENTS.md, .ingotignore and a denying hook', async ({ page }) => {
        await openIngot(page, dir);
        await newAgent(page, server);
        await composer(page).fill('how does the api handler in @packages/web/src/App.tsx work?');
        await composer(page).press('Enter');
        await expect(lastAnswer(page)).toHaveText('All checked.', { timeout: 60_000 });

        const first = systems[users.findIndex(u => u.includes('api handler'))];
        expect(first).toContain('Available rules');
        expect(first).toContain('- api-style: How to write API handlers');
        expect(first).toContain('ingot/fetch_rule');
        expect(first).not.toContain('API-STYLE-MARKER');
        expect(first).not.toContain('BEAR-MANUAL-MARKER');
        // Nested AGENTS.md only for files under its folder.
        expect(first).toContain('ROOT-AGENTS-MARKER');
        expect(first).toContain('WEB-AGENTS-MARKER');
        expect(first).not.toContain('API-AGENTS-MARKER');

        expect(users.find(u => u.startsWith('Tool result (ingot/fetch_rule)'))).toContain('API-STYLE-MARKER');
        const read = users.find(u => u.startsWith('Tool result (ingot/read_file)'))!;
        expect(read).toContain('.ingotignore');
        expect(read).not.toContain('HIDDEN-FILE-MARKER');
        expect(users.some(u => u.includes('HOOK-DENY-MARKER'))).toBe(true);
        expect(fs.existsSync(path.join(dir, 'build'))).toBe(false);

        const fetched = page.locator('#ingot-agents .ingot-chat-tool', { hasText: 'fetch_rule' });
        await expect(fetched).toContainText('api-style');
        await expect(fetched).toContainText('API-STYLE-MARKER');
        await expect(page.locator('#ingot-agents')).toContainText('beforeShellExecution · deny');
        await expect(page.locator('#ingot-approval-line')).toHaveCount(0);
        await shot(page, 'rules-fetch-hook-dark.png');
    });

    test('@ lists rules; a manual rule applies only through its chip; ignored files stay out of the picker', async ({ page }) => {
        await openIngot(page, dir);
        await newAgent(page, server);
        await composer(page).focus();
        await page.keyboard.type('@notes');
        const menu = page.locator('#ingot-mention-menu');
        await expect(menu).toBeVisible();
        await expect(menu).not.toContainText('Loading files');
        // Fuzzy matching still finds other files, never the .ingotignore'd one.
        await expect(menu.locator('[data-path]').first()).toBeVisible();
        await expect(menu).not.toContainText('notes.txt');
        for (let i = 0; i < 'notes'.length; i++) {
            await page.keyboard.press('Backspace');
        }
        await page.keyboard.type('bea');
        const rule = menu.locator('[data-rule="bear"]');
        await expect(rule).toContainText('manual (@)');
        await shot(page, 'rules-mention-menu.png');
        await rule.click();
        await expect(composer(page).locator('.ingot-chip-rule')).toContainText('@bear');
        await page.keyboard.type('build the header');
        await page.keyboard.press('Enter');
        await expect(lastAnswer(page)).toHaveText('Done.');
        expect(users.at(-1)).toContain('BEAR-MANUAL-MARKER');
        expect(systems.at(-1)).not.toContain('BEAR-MANUAL-MARKER');
    });

    test('/init writes AGENTS.md; User Rules adds and edits a project rule', async ({ page }) => {
        fs.rmSync(path.join(dir, 'AGENTS.md'));
        await openIngot(page, dir);
        await newAgent(page, server);
        await composer(page).focus();
        await page.keyboard.type('/ini');
        await expect(page.locator('#ingot-slash-menu')).toContainText('/init');
        await page.keyboard.press('Enter');
        await expect(page.locator('#ingot-agents')).toContainText('Wrote AGENTS.md', { timeout: 20_000 });
        const agents = fs.readFileSync(path.join(dir, 'AGENTS.md'), 'utf8');
        expect(agents).toContain('# AGENTS.md — rules-project');
        expect(agents).toContain('TypeScript');
        expect(agents).toContain('`npm run lint`');
        expect(agents).toContain('`packages/`');

        await openSettingsPage(page, 'user-rules');
        const project = page.locator('#ingot-rules-project');
        await expect(project.locator('[data-rule="api-style"]')).toContainText('agent requested');
        await expect(page.locator('#ingot-rules-global')).toBeVisible();
        await page.locator('#ingot-rules-add-project').click();
        await page.locator('#ingot-rules-new-name').fill('Error handling');
        await page.locator('#ingot-rules-new-kind').selectOption('agent');
        await page.locator('#ingot-rules-new-detail').fill('When adding try/catch');
        await page.locator('#ingot-rules-new-body').fill('Log every caught error.');
        await page.locator('#ingot-rules-new-save').click();
        const added = project.locator('[data-rule="error-handling"]');
        await expect(added.locator('.ingot-rules-kind')).toHaveText('agent requested');
        const file = path.join(dir, '.ingot', 'rules', 'error-handling.md');
        expect(fs.readFileSync(file, 'utf8')).toContain('description: "When adding try/catch"');

        await added.getByRole('button', { name: 'Edit error-handling' }).click();
        await page.locator('#ingot-rules-edit-text').fill('---\nalwaysApply: true\n---\nLog and rethrow.\n');
        await page.locator('#ingot-rules-edit-save').click();
        await expect(project.locator('[data-rule="error-handling"] .ingot-rules-kind')).toHaveText('always');
        await expect.poll(() => fs.readFileSync(file, 'utf8')).toContain('Log and rethrow.');
        await shot(page, 'user-rules-page.png');
        await page.locator('#ingot-settings-cancel').click();
    });

    test('Habits: a repeated instruction becomes a rule with one click and shows in the Habits page', async ({ page }) => {
        await openIngot(page, dir);
        const appearance = await currentAppearance(page);
        await openSettingsPage(page, 'habits');
        const toggle = page.locator('#ingot-habits-enabled');
        await toggle.check();
        await expect(toggle).toBeChecked();
        await page.locator('#ingot-settings-cancel').click();
        try {
            await newAgent(page, server);
            for (let i = 0; i < 3; i++) {
                await composer(page).fill('use Bear components');
                await composer(page).press('Enter');
                await expect(page.locator('#ingot-agents .ingot-chat-agent .ingot-md')).toHaveCount(i + 1);
            }
            const card = page.locator('#ingot-habit-cards .ingot-habit-card');
            await expect(card).toContainText('You often ask to use Bear components.');
            await expect(card).toContainText('3×');
            await shot(page, 'habit-card-dark.png');
            await setAppearance(page, 'light');
            await shot(page, 'habit-card-light.png');
            await card.locator('[data-target="rule"]').click();
            await expect(page.locator('#ingot-agents .ingot-habit-note').last()).toContainText('use Bear components → .ingot/rules/use-bear-components.md');
            const rule = fs.readFileSync(path.join(dir, '.ingot', 'rules', 'use-bear-components.md'), 'utf8');
            expect(rule).toContain('alwaysApply: true');
            expect(rule.toLowerCase()).toContain('bear components');
            expect(fs.readFileSync(path.join(dir, '.ingot', '.gitignore'), 'utf8')).toContain('habits.json');

            await openSettingsPage(page, 'habits');
            const row = page.locator('#ingot-habits-manager .ingot-habit-row').first();
            await expect(row).toContainText('3×');
            await expect(row).toContainText('saved · .ingot/rules/use-bear-components.md');
            await expect(row.locator('.ingot-habit-examples li')).toHaveCount(1);
            await shot(page, 'habits-page-light.png');
            await row.getByRole('button', { name: /Delete habit/ }).click();
            await expect(page.locator('#ingot-habits-manager .ingot-habit-row')).toHaveCount(0);
        } finally {
            if (!await page.locator('#ingot-settings').isVisible()) {
                await openSettingsPage(page, 'habits');
            }
            await page.locator('#ingot-habits-enabled').uncheck();
            await page.locator('#ingot-settings-cancel').click();
            await openSettingsPage(page, 'appearance');
            await page.locator('#ingot-setting-ingot-appearance').selectOption(appearance);
            await page.locator('#ingot-settings-ok').click();
        }
    });
});
