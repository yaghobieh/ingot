import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot, runCommand } from '../src/app.utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { CALC_SERVER, E2E_CONFIG_DIR } from '../src/e2e.consts';
import { startFakeIngotServer, type FakeIngotServer } from '../src/fake-ingot-server';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { seedRemoteConfig } from '../src/remote-config.e2e-utils';

/**
 * IDEA-287: a workspace with Cursor config asks once "Import?" and then "Convert to .ingot" or "Keep .cursor"; the answer
 * is remembered per workspace and "Cursor Config: Change Import Mode…" changes it. Both modes run rules (subfolders and
 * @file references), commands, MCP (with ${workspaceFolder} and envFile), ignore files and hooks. Team rules come from
 * the account.
 */
const SETTINGS_FILE = path.join(E2E_CONFIG_DIR, 'settings.json');
const MODES_FILE = path.join(E2E_CONFIG_DIR, 'cursor-workspaces.json');
const ASK = 'Cursor config found in this workspace';
const HOW = 'How should Ingot use the Cursor config?';

const GUARD = `let s = '';
process.stdin.on('data', d => { s += d; }).on('end', () => {
    const input = JSON.parse(s || '{}');
    const deny = /rm -rf/.test(input.command || '');
    process.stdout.write(JSON.stringify(deny ? { permission: 'deny', userMessage: 'Blocked by the Cursor guard', agentMessage: 'CURSOR-HOOK-DENY' } : { permission: 'allow' }));
});
`;

const readJson = (file: string): Record<string, unknown> => {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
        return {};
    }
};
const writeSettings = (patch: Record<string, unknown>): void =>
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...readJson(SETTINGS_FILE), ...patch }, undefined, 4));
const modeOf = (dir: string): unknown => (readJson(MODES_FILE).workspaces as Record<string, unknown> | undefined)?.[dir];

const write = (dir: string, file: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
};

const makeCursorProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-cursor-import-')));
    write(dir, 'package.json', JSON.stringify({ name: 'cursor-project', private: true }, undefined, 2));
    write(dir, 'src/app.ts', 'export const app = 1;\n');
    write(dir, 'AGENTS.md', 'ROOT-AGENTS-MARKER\n');
    write(dir, '.cursorrules', 'CURSORRULES-MARKER\n');
    write(dir, '.cursor/rules/always.mdc', '---\ndescription: House style\nalwaysApply: true\n---\nCURSOR-ALWAYS-MARKER\n');
    write(dir, '.cursor/rules/frontend/ui.mdc', '---\nalwaysApply: true\n---\nUI-SUBFOLDER-MARKER. Follow @docs/style.md for components.\n');
    write(dir, 'docs/style.md', 'REFERENCED-FILE-MARKER\n');
    write(dir, '.cursor/commands/ship.md', 'SHIP-COMMAND-MARKER: run the release checklist.\n');
    write(dir, 'tools/calc.mjs', fs.readFileSync(CALC_SERVER, 'utf8'));
    write(dir, '.env.calc', 'CALC_MODE=FROM-ENVFILE\n');
    write(dir, '.cursor/mcp.json', JSON.stringify({ mcpServers: { 'cursor-calc': { command: 'node', args: ['${workspaceFolder}/tools/calc.mjs'], envFile: '.env.calc' } } }, undefined, 2));
    write(dir, '.cursor/hooks/guard.js', GUARD);
    write(dir, '.cursor/hooks.json', JSON.stringify({ version: 1, hooks: { beforeShellExecution: [{ command: 'node .cursor/hooks/guard.js', timeout: 10 }] } }, undefined, 2));
    write(dir, '.cursorignore', 'private/\n');
    write(dir, 'private/notes.txt', 'HIDDEN-FILE-MARKER\n');
    write(dir, '.cursor/BUGBOT.md', 'BUGBOT-MARKER: look for missing awaits.\n');
    return dir;
};

/** Every file under `.cursor` plus the root Cursor files, so a test can prove they were left untouched. */
const cursorSnapshot = (dir: string): Record<string, string> => {
    const files: Record<string, string> = {};
    const walk = (rel: string): void => {
        for (const entry of fs.readdirSync(path.join(dir, rel), { withFileTypes: true })) {
            const child = path.join(rel, entry.name);
            if (entry.isDirectory()) {
                walk(child);
            } else {
                files[child] = fs.readFileSync(path.join(dir, child), 'utf8');
            }
        }
    };
    walk('.cursor');
    for (const file of ['.cursorrules', '.cursorignore', 'AGENTS.md']) {
        files[file] = fs.readFileSync(path.join(dir, file), 'utf8');
    }
    return files;
};

const composer = (page: Page): Locator => page.locator('#ingot-composer-input');
const lastAnswer = (page: Page): Locator => page.locator('#ingot-agents .ingot-chat-agent .ingot-md').last();
const toast = (page: Page, text: string): Locator => page.locator('.theia-notification-list-item').filter({ hasText: text }).first();
const occurrences = (text: string, marker: string): number => text.split(marker).length - 1;

const ask = async (page: Page, server: FakeOllama, prompt: string, answer: string): Promise<{ system: string; user: string }> => {
    const before = server.requests.length;
    const sent = (): FakeOllama['requests'][number] | undefined => server.requests.slice(before).find(r => r.user.includes(prompt));
    await composer(page).fill(prompt);
    await composer(page).press('Enter');
    await expect.poll(() => Boolean(sent()), { timeout: 60_000 }).toBe(true);
    await expect(lastAnswer(page)).toHaveText(answer, { timeout: 60_000 });
    return sent()!;
};

const appearance = async (page: Page): Promise<string> => {
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), page.locator('#ingot-settings'));
    await page.locator('#ingot-settings-node-appearance').click();
    const value = await page.locator('#ingot-setting-ingot-appearance').inputValue();
    await page.locator('#ingot-settings-cancel').click();
    return value;
};

/** Light and dark screenshots of the same state. */
const shots = async (page: Page, name: string): Promise<void> => {
    await setAppearance(page, 'light');
    await shot(page, `${name}-light.png`);
    await setAppearance(page, 'dark');
    await shot(page, `${name}-dark.png`);
};

const newAgent = async (page: Page, server: FakeOllama): Promise<void> => {
    await connectOllama(page, server);
    await page.locator('#ingot-agents-new').click();
    await pickModel(page, 'ollama-local');
};

const answerFirstQuestion = async (page: Page, button: string, screenshot?: string): Promise<void> => {
    const prompt = toast(page, ASK);
    await expect(prompt).toBeVisible({ timeout: 30_000 });
    await expect(prompt).toContainText('.cursor/rules');
    await expect(prompt).toContainText('AGENTS.md');
    if (screenshot) {
        await shots(page, screenshot);
    }
    await prompt.getByRole('button', { name: button, exact: true }).click();
};

const answerSecondQuestion = async (page: Page, button: string, screenshot?: string): Promise<void> => {
    const how = toast(page, HOW);
    await expect(how).toBeVisible();
    await expect(how).toContainText('.cursor stays untouched');
    if (screenshot) {
        await shots(page, screenshot);
    }
    await how.getByRole('button', { name: button, exact: true }).click();
};

/** Opens the "Read rules" step of the last turn (what the screenshots of a working rule show). */
const showRules = async (page: Page): Promise<void> => {
    const read = page.locator('#ingot-agents .ingot-chat-read').filter({ hasText: 'rules' }).last();
    await expect(read).toBeVisible();
    await read.locator('.ingot-chat-read-label').click();
    await expect(read.locator('.ingot-chat-read-list li').first()).toBeVisible();
};

/** A slash command from the project shows in the menu and expands into the prompt. */
const runSlashCommand = async (page: Page, server: FakeOllama): Promise<string> => {
    await composer(page).focus();
    await page.keyboard.type('/shi');
    await expect(page.locator('#ingot-slash-menu')).toContainText('/ship');
    await page.keyboard.press('Enter');
    await expect(composer(page)).toHaveText(/^\/ship\s*$/);
    await page.keyboard.type('today');
    const before = server.requests.length;
    await page.keyboard.press('Enter');
    await expect.poll(() => server.requests.slice(before).some(r => r.user.includes('SHIP-COMMAND-MARKER')), { timeout: 60_000 }).toBe(true);
    await expect(page.locator('#ingot-agents .ingot-chat-agent .ingot-md').filter({ hasText: 'Shipped.' })).toHaveCount(1);
    return server.requests.slice(before).find(r => r.user.includes('SHIP-COMMAND-MARKER'))!.user;
};

/** Turns the project's cursor-calc server on and calls its `mode` tool, which reports CALC_MODE from the envFile. */
const checkMcp = async (page: Page, server: FakeOllama): Promise<void> => {
    await page.locator('#ingot-rs-mcp').click();
    await page.locator('.ingot-mcp #ingot-mcp-tab-mcps').click();
    const row = page.locator('.ingot-mcp #ingot-mcp-row-cursor-calc');
    await row.locator('.ingot-mcp-toggle').check({ force: true });
    await expect(row.locator('.ingot-mcp-summary')).toHaveText(/2 tools enabled/, { timeout: 20_000 });
    await composer(page).fill('calc mode please');
    await composer(page).press('Enter');
    await expect(page.locator('#ingot-approval-line')).toContainText('cursor-calc: mode', { timeout: 30_000 });
    await page.locator('#ingot-approval-run').click();
    await expect(lastAnswer(page)).toHaveText('Done with cursor-calc/mode.', { timeout: 30_000 });
    expect(server.requests.find(r => r.user.startsWith('Tool result (cursor-calc/mode)'))?.user).toContain('FROM-ENVFILE');
    await row.locator('.ingot-mcp-toggle').uncheck({ force: true });
    await expect(row.locator('.ingot-mcp-summary')).toHaveText('Disabled');
};
const ingotCopies = (dir: string): string[] =>
    ['.ingot/rules', '.ingot/commands', '.ingot/mcp.json', '.ingot/hooks.json', '.ingotignore'].filter(f => fs.existsSync(path.join(dir, f)));

test.describe('IDEA-287 Cursor config: first-open import, Convert / Keep, change later', () => {
    test.setTimeout(240_000);
    let dir: string;
    let server: FakeOllama;
    let initialAppearance: string | undefined;

    test.beforeEach(async () => {
        // Team rules cached by another spec would show up in these rule lists.
        seedRemoteConfig();
        dir = makeCursorProject();
        writeSettings({ 'ingot.import.cursorRules': 'ask' });
        initialAppearance = undefined;
        server = await startFakeOllama((_system, user) => {
            const tool = /^Tool result \(([^)]+)\)/.exec(user);
            if (tool) {
                return `Done with ${tool[1]}.`;
            }
            if (user.includes('cleanup')) {
                return '<<<TOOL ingot/run\n{"command": "rm -rf build"}\n>>>END';
            }
            if (user.includes('read private')) {
                return '<<<TOOL ingot/read_file\n{"path": "private/notes.txt"}\n>>>END';
            }
            if (user.includes('calc mode')) {
                return '<<<TOOL cursor-calc/mode\n{}\n>>>END';
            }
            if (user.includes('SHIP-COMMAND-MARKER')) {
                return 'Shipped.';
            }
            return 'Rules checked.';
        }, { delayMs: 0 });
    });

    test.afterEach(async ({ page }) => {
        if (initialAppearance) {
            await setAppearance(page, initialAppearance === 'dark' ? 'dark' : 'light').catch(() => undefined);
        }
        writeSettings({ 'ingot.import.cursorRules': 'never' });
        const modes = readJson(MODES_FILE);
        const workspaces = { ...(modes.workspaces as Record<string, unknown> | undefined ?? {}) };
        delete workspaces[dir];
        fs.writeFileSync(MODES_FILE, JSON.stringify({ version: 1, workspaces }, undefined, 2));
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('Import → Keep .cursor: nothing is copied and rules, commands, MCP, .cursorignore and hooks run from .cursor', async ({ page }) => {
        await openIngot(page, dir);
        initialAppearance = await appearance(page);
        await answerFirstQuestion(page, 'Import', 'cursor-import-prompt');
        await answerSecondQuestion(page, 'Keep .cursor', 'cursor-convert-or-keep');
        await expect.poll(() => modeOf(dir)).toBe('keep');
        expect(ingotCopies(dir)).toEqual([]);
        await dismissNotifications(page);

        await newAgent(page, server);
        const turn = await ask(page, server, 'check rules for src/app.ts', 'Rules checked.');
        for (const marker of ['CURSOR-ALWAYS-MARKER', 'UI-SUBFOLDER-MARKER', 'REFERENCED-FILE-MARKER', 'CURSORRULES-MARKER', 'ROOT-AGENTS-MARKER']) {
            expect(turn.system, marker).toContain(marker);
        }
        await showRules(page);
        await expect(page.locator('#ingot-agents .ingot-chat-read-list').last()).toContainText('frontend/ui');
        await shots(page, 'cursor-rule-keep-mode');

        await ask(page, server, 'read private notes', 'Done with ingot/read_file.');
        const read = server.requests.find(r => r.user.startsWith('Tool result (ingot/read_file)'))!;
        expect(read.user).not.toContain('HIDDEN-FILE-MARKER');
        await ask(page, server, 'run cleanup', 'Done with ingot/run.');
        expect(server.requests.some(r => r.user.includes('CURSOR-HOOK-DENY'))).toBe(true);
        await expect(page.locator('#ingot-agents')).toContainText('beforeShellExecution · deny');

        expect(await runSlashCommand(page, server)).toContain('SHIP-COMMAND-MARKER');
        await checkMcp(page, server);
        expect(ingotCopies(dir)).toEqual([]);

        // Remembered: the next open does not ask again.
        await openIngot(page, dir);
        await page.waitForTimeout(2_000);
        await expect(page.locator('.theia-notification-list-item').filter({ hasText: ASK })).toHaveCount(0);
    });

    test('Import → Convert to .ingot: everything is copied and translated, .cursor stays untouched and is no longer read', async ({ page }) => {
        const before = cursorSnapshot(dir);
        await openIngot(page, dir);
        initialAppearance = await appearance(page);
        await answerFirstQuestion(page, 'Import');
        await answerSecondQuestion(page, 'Convert to .ingot');
        await expect(toast(page, 'Converted Cursor config into .ingot')).toBeVisible({ timeout: 30_000 });
        await expect.poll(() => modeOf(dir)).toBe('convert');

        const ingot = (file: string): string => fs.readFileSync(path.join(dir, '.ingot', file), 'utf8');
        expect(ingot('rules/always.md')).toContain('alwaysApply: true');
        expect(ingot('rules/always.md')).toContain('CURSOR-ALWAYS-MARKER');
        expect(ingot('rules/frontend/ui.md')).toContain('@docs/style.md');
        expect(ingot('rules/cursorrules.md')).toContain('CURSORRULES-MARKER');
        expect(ingot('rules/agents.md')).toContain('ROOT-AGENTS-MARKER');
        expect(ingot('commands/ship.md')).toContain('SHIP-COMMAND-MARKER');
        expect(ingot('BUGBOT.md')).toContain('BUGBOT-MARKER');
        expect(ingot('hooks/guard.js')).toBe(GUARD);
        expect(JSON.parse(ingot('hooks.json')).hooks.beforeShellExecution[0].command).toBe('node .ingot/hooks/guard.js');
        expect(JSON.parse(ingot('mcp.json')).mcpServers['cursor-calc']).toMatchObject({ envFile: '.env.calc' });
        expect(fs.readFileSync(path.join(dir, '.ingotignore'), 'utf8')).toBe('private/\n');
        expect(cursorSnapshot(dir)).toEqual(before);

        // .cursor is not read any more: a change there does not reach the agent, and nothing is applied twice.
        write(dir, '.cursor/rules/always.mdc', '---\nalwaysApply: true\n---\nCURSOR-ONLY-MARKER\n');
        await dismissNotifications(page);
        await newAgent(page, server);
        const turn = await ask(page, server, 'check rules for src/app.ts', 'Rules checked.');
        expect(turn.system).not.toContain('CURSOR-ONLY-MARKER');
        for (const marker of ['CURSOR-ALWAYS-MARKER', 'UI-SUBFOLDER-MARKER', 'REFERENCED-FILE-MARKER', 'CURSORRULES-MARKER', 'ROOT-AGENTS-MARKER']) {
            expect(occurrences(turn.system, marker), marker).toBe(1);
        }
        await showRules(page);
        await expect(page.locator('#ingot-agents .ingot-chat-read-list').last()).toContainText('frontend/ui');
        await shots(page, 'cursor-rule-convert-mode');

        await ask(page, server, 'read private notes', 'Done with ingot/read_file.');
        expect(server.requests.find(r => r.user.startsWith('Tool result (ingot/read_file)'))!.user).not.toContain('HIDDEN-FILE-MARKER');
        await ask(page, server, 'run cleanup', 'Done with ingot/run.');
        expect(server.requests.some(r => r.user.includes('CURSOR-HOOK-DENY'))).toBe(true);

        expect(await runSlashCommand(page, server)).toContain('SHIP-COMMAND-MARKER');
        await checkMcp(page, server);
    });

    test('Don\'t import: Cursor files are ignored (AGENTS.md still read); Change Import Mode switches to Keep later', async ({ page }) => {
        await openIngot(page, dir);
        await answerFirstQuestion(page, 'Don\'t import');
        await expect.poll(() => modeOf(dir)).toBe('off');
        await dismissNotifications(page);
        await newAgent(page, server);
        const off = await ask(page, server, 'check rules for src/app.ts', 'Rules checked.');
        expect(off.system).toContain('ROOT-AGENTS-MARKER');
        expect(off.system).not.toContain('CURSOR-ALWAYS-MARKER');
        expect(off.system).not.toContain('CURSORRULES-MARKER');

        await runCommand(page, 'Cursor Config: Change Import Mode…');
        const option = (label: string): Locator => page.locator('.quick-input-list [role="option"]').filter({ hasText: label }).first();
        const keep = option('Keep .cursor');
        await expect(option('Do not use Cursor config')).toContainText('current');
        await keep.click();
        await expect.poll(() => modeOf(dir)).toBe('keep');
        const kept = await ask(page, server, 'check rules again', 'Rules checked.');
        expect(kept.system).toContain('CURSOR-ALWAYS-MARKER');
        expect(ingotCopies(dir)).toEqual([]);
    });
});

test.describe('IDEA-287 team rules from the account', () => {
    let ingot: FakeIngotServer;
    let server: FakeOllama;

    test.beforeEach(async () => {
        ingot = await startFakeIngotServer();
        ingot.config = {
            teamRules: [
                { name: 'org-security', body: 'TEAM-ENFORCED-MARKER: never log tokens.', enforced: true },
                { name: 'org-style', body: 'TEAM-OPTIONAL-MARKER: prefer small functions.', alwaysApply: true }
            ]
        };
        server = await startFakeOllama(() => 'Team checked.', { delayMs: 0 });
    });

    test.afterEach(async () => {
        seedRemoteConfig();
        writeSettings({ 'ingot.rules.disabledTeamRules': [] });
        await server.close();
        await ingot.close();
    });

    const openSettings = async (page: Page): Promise<void> => {
        await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), page.locator('#ingot-settings'));
        await page.locator('#ingot-settings-node-user-rules').click();
    };

    test('enforced team rules always apply; others can be turned off on the User Rules page', async ({ page }) => {
        const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-team-rules-')));
        try {
            write(dir, 'src/app.ts', 'export const app = 1;\n');
            await openIngot(page, dir);
            await expect.poll(() => ingot.configCalls.length).toBeGreaterThan(0);
            await dismissNotifications(page);
            await newAgent(page, server);
            const first = await ask(page, server, 'team check', 'Team checked.');
            expect(first.system).toContain('TEAM-ENFORCED-MARKER');
            expect(first.system).toContain('TEAM-OPTIONAL-MARKER');

            await openSettings(page);
            const team = page.locator('#ingot-rules-team');
            await expect(team.locator('[data-rule="org-security"]')).toContainText('enforced');
            await expect(team.locator('[data-rule="org-security"] input')).toBeDisabled();
            await team.locator('[data-rule="org-style"] input').click();
            await expect(team.locator('[data-rule="org-style"] input')).not.toBeChecked();
            await shot(page, 'team-rules-page.png');
            await page.locator('#ingot-settings-cancel').click();

            const second = await ask(page, server, 'team check again', 'Team checked.');
            expect(second.system).toContain('TEAM-ENFORCED-MARKER');
            expect(second.system).not.toContain('TEAM-OPTIONAL-MARKER');
        } finally {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
});
