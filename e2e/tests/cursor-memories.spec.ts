import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot, runCommand } from '../src/app.utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import { E2E_CONFIG_DIR, IMPORT_HOME } from '../src/e2e.consts';
import { startOpenPlanServer, type FakeIngotServer } from '../src/fake-ingot-server';

/**
 * IDEA-287: Cursor memories on disk (`.cursor/memories/*.md` in the project, `~/.cursor/memories.json`) are offered once
 * after the workspace imports its Cursor config. Project ones become repo facts, the user's become global preferences.
 */
const SETTINGS_FILE = path.join(E2E_CONFIG_DIR, 'settings.json');
const MODES_FILE = path.join(E2E_CONFIG_DIR, 'cursor-workspaces.json');
const USER_EXPORT = path.join(IMPORT_HOME, '.cursor', 'memories.json');
const GLOBAL_MEMORY_DIR = path.join(E2E_CONFIG_DIR, 'memory');
const PROJECT_MARKER = 'Build with pnpm run ship.';
const USER_MARKER = 'CURSOR-USER-MEMORY: answer in short bullet points.';

const readJson = (file: string): Record<string, unknown> => {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
        return {};
    }
};
const writeSettings = (patch: Record<string, unknown>): void =>
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...readJson(SETTINGS_FILE), ...patch }, undefined, 4));
const write = (dir: string, file: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
};
const memoryFiles = (dir: string, marker: string): string[] =>
    fs.existsSync(dir) ? fs.readdirSync(dir).filter(f => f.endsWith('.md')).map(f => path.join(dir, f)).filter(f => fs.readFileSync(f, 'utf8').includes(marker)) : [];

const toast = (page: Page, text: string): Locator => page.locator('.theia-notification-list-item').filter({ hasText: text }).first();
const menuItem = (page: Page, label: string): Locator =>
    page.locator('.lm-Menu .lm-Menu-item', { has: page.locator('.lm-Menu-itemLabel', { hasText: new RegExp(`^${label}$`) }) });

const shots = async (page: Page, name: string): Promise<void> => {
    await setAppearance(page, 'light');
    await shot(page, `${name}-light.png`);
    await setAppearance(page, 'dark');
    await shot(page, `${name}-dark.png`);
};

const appearance = async (page: Page): Promise<string> => {
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), page.locator('#ingot-settings'));
    await page.locator('#ingot-settings-node-appearance').click();
    const value = await page.locator('#ingot-setting-ingot-appearance').inputValue();
    await page.locator('#ingot-settings-cancel').click();
    return value;
};

test.describe('IDEA-287 import Cursor memories', () => {
    test.setTimeout(180_000);
    let dir: string;
    let initialAppearance: string | undefined;
    let account: FakeIngotServer;

    test.beforeEach(async () => {
        // The Memories page is part of the agent, which the plan gate locks for signed-out users.
        account = await startOpenPlanServer();
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-cursor-memories-')));
        write(dir, 'package.json', JSON.stringify({ name: 'cursor-memories', private: true }, undefined, 2));
        write(dir, '.cursor/rules/style.mdc', '---\nalwaysApply: true\n---\nSTYLE\n');
        write(dir, '.cursor/memories/build.md', `---\ntitle: Build\n---\n${PROJECT_MARKER}\n`);
        fs.writeFileSync(USER_EXPORT, JSON.stringify({ memories: [{ memory: USER_MARKER }] }, undefined, 2));
        writeSettings({ 'ingot.import.cursorRules': 'ask' });
        initialAppearance = undefined;
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
        fs.rmSync(USER_EXPORT, { force: true });
        for (const file of memoryFiles(GLOBAL_MEMORY_DIR, USER_MARKER)) {
            fs.rmSync(file, { force: true });
        }
        fs.rmSync(dir, { recursive: true, force: true });
        await account.close();
        fs.rmSync(path.join(E2E_CONFIG_DIR, 'remote-config.json'), { force: true });
    });

    test('after "Import → Keep .cursor" Ingot offers the memories once and imports facts and preferences', async ({ page }) => {
        await openIngot(page, dir);
        await expect.poll(() => account.configCalls.length).toBeGreaterThan(0);
        initialAppearance = await appearance(page);
        await toast(page, 'Cursor config found in this workspace').getByRole('button', { name: 'Import', exact: true }).click();
        await toast(page, 'How should Ingot use the Cursor config?').getByRole('button', { name: 'Keep .cursor', exact: true }).click();

        const offer = toast(page, 'Found 2 Cursor memories');
        await expect(offer).toBeVisible({ timeout: 30_000 });
        await expect(offer).toContainText('1 repo fact from .cursor and 1 preference from ~/.cursor');
        await shots(page, 'cursor-memories-offer');
        await offer.getByRole('button', { name: 'Import memories', exact: true }).click();
        await expect(toast(page, 'Imported 1 repo fact from .cursor and 1 preference from ~/.cursor into Ingot memory.')).toBeVisible({ timeout: 30_000 });

        const projectFiles = memoryFiles(path.join(dir, '.ingot', 'memory'), PROJECT_MARKER);
        expect(projectFiles).toHaveLength(1);
        expect(fs.readFileSync(projectFiles[0], 'utf8')).toContain('kind: fact');
        const userFiles = memoryFiles(GLOBAL_MEMORY_DIR, USER_MARKER);
        expect(userFiles).toHaveLength(1);
        expect(fs.readFileSync(userFiles[0], 'utf8')).toContain('kind: preference');

        await dismissNotifications(page);
        await page.locator('#ingot-stripe-settings').click();
        await menuItem(page, 'Memories').click();
        const manager = page.locator('.ingot-memories');
        await expect(manager).toContainText(PROJECT_MARKER);
        await expect(manager).toContainText(USER_MARKER);
        await shots(page, 'cursor-memories-imported');
        await page.keyboard.press('Escape');

        // Already imported: the command finds nothing new.
        await runCommand(page, 'Cursor Config: Import Memories');
        await expect(toast(page, 'No Cursor memories to import')).toBeVisible({ timeout: 30_000 });
    });
});
