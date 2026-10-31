import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, openIngot, runCommand } from '../src/app.utils';
import { CONFIG_PROJECT, FIXTURES_DIR, FIXTURE_WORKSPACE, MULTI_ROOT_WORKSPACE } from '../src/e2e.consts';

/** The URL fragment New Window uses: the window opens without a folder. */
const NO_FOLDER = '!empty';
const SECOND_PROJECT = path.join(FIXTURES_DIR, 'second-project');
const SHOTS = process.env.INGOT_SCREENSHOT_DIR;
const CHATS_KEY = 'ingot.chats.v1';
const FIXTURE_CHAT = 'Chat from the sample project window';

const setScheme = async (page: Page, theme: 'Ingot Light' | 'Ingot Dark'): Promise<void> => {
    await runCommand(page, 'Preferences: Color Theme');
    await page.locator('.quick-input-widget input').fill(theme);
    await page.locator('.quick-input-list .monaco-list-row', { hasText: theme }).first().click();
    await expect(page.locator('body')).toHaveClass(theme === 'Ingot Dark' ? /theia-dark/ : /theia-light/);
};

const shot = async (page: Page, name: string): Promise<void> => {
    if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, `${name}.png`) });
    }
};

test.describe('IDEA-266 empty-window welcome screen', () => {
    test('a window without a folder shows only the welcome screen, with no agent chat', async ({ page }) => {
        for (const workspace of [CONFIG_PROJECT, MULTI_ROOT_WORKSPACE, SECOND_PROJECT, FIXTURE_WORKSPACE]) {
            await openIngot(page, workspace);
        }
        await openIngot(page, NO_FOLDER);

        const welcome = page.locator('#ingot-welcome');
        await expect(welcome).toBeVisible();
        await expect(welcome.locator('.ingot-welcome-title')).toHaveText('Ingot');
        await expect(welcome.locator('svg.ingot-mark').first()).toBeAttached();
        await expect(welcome.locator('#ingot-welcome-plan')).not.toBeEmpty();
        await expect(welcome.locator('#ingot-welcome-settings')).toHaveText('Settings');
        await expect(welcome.locator('.ingot-welcome-card')).toHaveText(['Open project', 'Clone repo', 'Connect via SSH']);

        // Recent projects: name (with the kind for workspaces) and the folder it lives in.
        const projects = welcome.locator('#ingot-welcome-workspaces .ingot-welcome-project');
        await expect(projects.first()).toContainText('sample-project');
        await expect(projects.first().locator('.ingot-welcome-project-path')).toHaveText(/fixtures$/);
        await expect(projects.filter({ hasText: 'multi-root' })).toContainText('(Workspace)');
        await expect(welcome.locator('#ingot-welcome-view-all')).toHaveText(/View all \(\d+\)/);

        // No agent chat, tool window stripes or tab strip: the window is the welcome screen only.
        await expect(page.locator('#ingot-agents')).toHaveCount(0);
        await expect(page.locator('#theia-left-content-panel')).toBeHidden();
        await expect(page.locator('#theia-right-content-panel')).toBeHidden();
        await expect(page.locator('#ingot-tb-chat')).toBeHidden();
        await expect(page.locator('#ingot-tb-agents-window')).toBeHidden();
        await expect(page.locator('body')).toHaveClass(/ingot-no-folder/);
        await expect(page.locator('#theia-main-content-panel .lm-TabBar').first()).toBeHidden();

        await setScheme(page, 'Ingot Dark');
        await shot(page, 'welcome-dark');
        await setScheme(page, 'Ingot Light');
        await shot(page, 'welcome-light');

        // View all opens the full recent list.
        await welcome.locator('#ingot-welcome-view-all').click();
        await expect(page.locator('.quick-input-list .monaco-list-row', { hasText: 'second-project' }).first()).toBeVisible();
        await page.keyboard.press('Escape');
    });

    test('a new window does not copy the previous window chats', async ({ page }) => {
        await openIngot(page, FIXTURE_WORKSPACE);
        const workspace = `file://${FIXTURE_WORKSPACE}`;
        await page.evaluate(({ key, title, uri }) => {
            const chat = { id: 'e2e-266', title, status: 'idle', updatedAt: Date.now(), mode: 'agent', model: 'auto', messages: [{ role: 'user', text: title }], plan: [], steps: [], changes: [], open: true, openedAt: 1, workspace: uri };
            localStorage.setItem(key, JSON.stringify([chat]));
        }, { key: CHATS_KEY, title: FIXTURE_CHAT, uri: workspace });

        // The same project shows its chat.
        await openIngot(page, FIXTURE_WORKSPACE);
        await expect(page.locator('#ingot-agents .ingot-chat-tab', { hasText: FIXTURE_CHAT })).toBeVisible();

        // File > New Window: no chat panel at all.
        await openIngot(page, NO_FOLDER);
        await expect(page.locator('#ingot-welcome')).toBeVisible();
        await expect(page.locator('#ingot-agents')).toHaveCount(0);

        // Another project opened in a new window starts with its own (empty) chats, and the first project keeps its chat.
        await openIngot(page, SECOND_PROJECT);
        await expect(page.locator('#ingot-agents')).toBeVisible();
        await expect(page.locator('#ingot-agents .ingot-chat-tab', { hasText: FIXTURE_CHAT })).toHaveCount(0);
        const stored = await page.evaluate(key => localStorage.getItem(key) ?? '', CHATS_KEY);
        expect(stored).toContain(FIXTURE_CHAT);
    });

    test('Clone repo asks for a URL and rejects odd ones', async ({ page }) => {
        await openIngot(page, NO_FOLDER);
        const input = page.locator('.quick-input-widget input.input');
        await actUntilVisible(() => page.locator('#ingot-welcome-clone').click(), input);
        await expect(page.locator('.quick-input-widget')).toContainText('Repository URL');
        await input.fill('--upload-pack=evil');
        await expect(page.locator('.quick-input-widget')).toContainText('Enter an https or ssh Git URL.');
        await page.keyboard.press('Escape');
        await expect(input).toBeHidden();
    });

    test('Connect via SSH asks for a host and rejects ssh options', async ({ page }) => {
        await openIngot(page, NO_FOLDER);
        const input = page.locator('.quick-input-widget input.input');
        await actUntilVisible(() => page.locator('#ingot-welcome-ssh').click(), input);
        await expect(page.locator('.quick-input-widget')).toContainText('SSH host');
        await input.fill('-oProxyCommand=evil');
        await expect(page.locator('.quick-input-widget')).toContainText('Enter a host like user@host');
        await page.keyboard.press('Escape');
        await expect(input).toBeHidden();
    });

    test('opening a recent project from the welcome screen loads it, with the agent chat', async ({ page }) => {
        await openIngot(page, FIXTURE_WORKSPACE);
        await openIngot(page, NO_FOLDER);
        await page.locator('#ingot-welcome-workspaces .ingot-welcome-project', { hasText: 'sample-project' }).first().click();
        await expect(page.locator('#ingot-tb-project')).toContainText('sample-project', { timeout: 60_000 });
        await expect(page.locator('#ingot-agents')).toBeVisible();
        await expect(page.locator('body')).not.toHaveClass(/ingot-no-folder/);
    });
});
