import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot, runCommand } from '../src/app.utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import { E2E_CONFIG_DIR } from '../src/e2e.consts';

/**
 * IDEA-287: after "Convert to .ingot", later `.cursor` changes ask "Pull the changes into .ingot?". Pulling updates files the
 * user has not touched, adds new ones, removes ones whose Cursor source is gone, and keeps the user's own `.ingot` edits.
 */
const SETTINGS_FILE = path.join(E2E_CONFIG_DIR, 'settings.json');
const MODES_FILE = path.join(E2E_CONFIG_DIR, 'cursor-workspaces.json');
const SYNC_FILE = path.join(E2E_CONFIG_DIR, 'cursor-sync.json');
const CHANGED = 'Cursor config changed in this workspace';

const readJson = (file: string): Record<string, unknown> => {
    try {
        return JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    } catch {
        return {};
    }
};
const writeSettings = (patch: Record<string, unknown>): void =>
    fs.writeFileSync(SETTINGS_FILE, JSON.stringify({ ...readJson(SETTINGS_FILE), ...patch }, undefined, 4));
const forget = (file: string, dir: string): void => {
    const data = readJson(file);
    const workspaces = { ...(data.workspaces as Record<string, unknown> | undefined ?? {}) };
    delete workspaces[dir];
    fs.writeFileSync(file, JSON.stringify({ version: 1, workspaces }, undefined, 2));
};

const write = (dir: string, file: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
};
const rule = (marker: string): string => `---\nalwaysApply: true\n---\n${marker}\n`;

const makeProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-cursor-sync-')));
    write(dir, 'package.json', JSON.stringify({ name: 'cursor-sync', private: true }, undefined, 2));
    write(dir, '.cursor/rules/style.mdc', rule('STYLE-V1'));
    write(dir, '.cursor/rules/tests.mdc', rule('TESTS-V1'));
    write(dir, '.cursor/commands/ship.md', 'SHIP-COMMAND\n');
    return dir;
};

const toast = (page: Page, text: string): Locator => page.locator('.theia-notification-list-item').filter({ hasText: text }).first();

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

test.describe('IDEA-287 Convert mode keeps .ingot in sync with .cursor', () => {
    test.setTimeout(180_000);
    let dir: string;
    let initialAppearance: string | undefined;

    test.beforeEach(() => {
        dir = makeProject();
        writeSettings({ 'ingot.import.cursorRules': 'ask' });
        initialAppearance = undefined;
    });

    test.afterEach(async ({ page }) => {
        if (initialAppearance) {
            await setAppearance(page, initialAppearance === 'dark' ? 'dark' : 'light').catch(() => undefined);
        }
        writeSettings({ 'ingot.import.cursorRules': 'never' });
        forget(MODES_FILE, dir);
        forget(SYNC_FILE, dir);
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('a later .cursor change prompts, and "Pull changes" updates, adds and removes files but keeps .ingot edits', async ({ page }) => {
        const ingot = (file: string): string => path.join(dir, '.ingot', file);
        await openIngot(page, dir);
        initialAppearance = await appearance(page);
        await toast(page, 'Cursor config found in this workspace').getByRole('button', { name: 'Import', exact: true }).click();
        await toast(page, 'How should Ingot use the Cursor config?').getByRole('button', { name: 'Convert to .ingot', exact: true }).click();
        await expect(toast(page, 'Converted Cursor config into .ingot')).toBeVisible({ timeout: 30_000 });
        await expect.poll(() => Object.keys((readJson(SYNC_FILE).workspaces as Record<string, object> | undefined)?.[dir] ?? {}).length).toBe(3);
        await dismissNotifications(page);

        write(dir, '.cursor/rules/style.mdc', rule('STYLE-V2'));
        write(dir, '.cursor/rules/tests.mdc', rule('TESTS-V2'));
        write(dir, '.ingot/rules/tests.md', rule('MY-OWN-TESTS-RULE'));
        write(dir, '.cursor/rules/review.mdc', rule('REVIEW-NEW'));
        fs.rmSync(path.join(dir, '.cursor/commands/ship.md'));

        const prompt = toast(page, CHANGED);
        await expect(prompt).toBeVisible({ timeout: 30_000 });
        await expect(prompt).toContainText('1 updated, 1 new and 1 removed');
        await expect(prompt).toContainText('.ingot/rules/tests.md changed in .cursor and edited in .ingot');
        await shots(page, 'cursor-sync-prompt');
        await prompt.getByRole('button', { name: 'Pull changes', exact: true }).click();

        const done = toast(page, 'Pulled Cursor changes into .ingot');
        await expect(done).toBeVisible({ timeout: 30_000 });
        await expect(done).toContainText('1 conflict');
        await shots(page, 'cursor-sync-pulled');
        expect(fs.readFileSync(ingot('rules/style.md'), 'utf8')).toContain('STYLE-V2');
        expect(fs.readFileSync(ingot('rules/review.md'), 'utf8')).toContain('REVIEW-NEW');
        expect(fs.readFileSync(ingot('rules/tests.md'), 'utf8')).toContain('MY-OWN-TESTS-RULE');
        expect(fs.existsSync(ingot('commands/ship.md'))).toBe(false);

        await dismissNotifications(page);
        await runCommand(page, 'Cursor Config: Pull Changes into .ingot');
        await expect(toast(page, '.ingot is in sync with this workspace\'s Cursor config.')).toBeVisible({ timeout: 30_000 });
    });
});
