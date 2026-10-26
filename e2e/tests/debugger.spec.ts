import { expect, test, type Page } from '@playwright/test';
import * as fs from 'fs';
import * as path from 'path';
import { dismissNotifications, openIngot, quickInput, runCommand } from '../src/app.utils';
import { FIXTURES_DIR } from '../src/e2e.consts';

const PROJECT = path.join(FIXTURES_DIR, 'debug-project');
const LAUNCH_DIR = path.join(PROJECT, '.ingot');
const BREAKPOINT_LINE = 4;
const SESSION_TIMEOUT_MS = 60_000;

const pickRow = (page: Page, text: string) => page.locator('.quick-input-list .monaco-list-row').filter({ hasText: text }).first();

const openFile = async (page: Page, name: string): Promise<void> => {
    await page.keyboard.press('F1');
    await expect(quickInput(page)).toBeVisible();
    await quickInput(page).fill(name);
    await pickRow(page, name).click();
    await expect(page.locator('.theia-editor')).toBeVisible();
};

const selectConfiguration = async (page: Page, name: string): Promise<void> => {
    await page.locator('#ingot-tb-run-config').click();
    await pickRow(page, name).click();
    await expect(page.locator('#ingot-tb-run-config')).toContainText(name);
};

test.describe('debugger (IDEA-138)', () => {
    test.afterAll(() => fs.rmSync(LAUNCH_DIR, { recursive: true, force: true }));

    test('detects run/debug configurations and saves one to .ingot/launch.json', async ({ page }) => {
        await openIngot(page, PROJECT);
        await dismissNotifications(page);
        await page.locator('#ingot-tb-run-config').click();
        for (const name of ['npm run start', 'Node.js: Current file', 'PHP: Listen for Xdebug', 'PHP: Current script']) {
            await expect(pickRow(page, name)).toBeVisible();
        }
        await pickRow(page, 'Edit Run/Debug Configurations').click();
        await expect(page.locator('.ingot-dc')).toBeVisible();
        await page.locator('#ingot-dc-add').selectOption('php-listen');
        await expect(page.locator('#ingot-dc-name')).toHaveValue('PHP: Listen for Xdebug');
        await expect(page.locator('.ingot-dc-form input[data-key="port"]')).toHaveValue('9003');
        await page.locator('#ingot-dc-name').fill('PHP: Docker');
        await page.locator('#ingot-dc-save').click();
        await expect(page.locator('.ingot-dc-item.selected')).toContainText('PHP: Docker');
        await expect.poll(() => fs.existsSync(path.join(LAUNCH_DIR, 'launch.json')) && fs.readFileSync(path.join(LAUNCH_DIR, 'launch.json'), 'utf8')).toContain('"PHP: Docker"');
        // A saved configuration becomes selectable in the title bar.
        await selectConfiguration(page, 'PHP: Docker');
        await page.locator('#ingot-dc-remove').click();
        await expect(page.locator('.ingot-dc-item', { hasText: 'PHP: Docker' })).toHaveCount(0);
    });

    test('stops at a breakpoint, shows variables and step controls, and stops', async ({ page }) => {
        await openIngot(page, PROJECT);
        await dismissNotifications(page);
        await openFile(page, 'index.js');
        await runCommand(page, 'Go to Line');
        await quickInput(page).fill(`:${BREAKPOINT_LINE}`);
        await page.keyboard.press('Enter');
        await runCommand(page, 'Toggle Breakpoint');
        await expect(page.locator('.theia-debug-breakpoint-icon, .codicon-debug-breakpoint').first()).toBeVisible();
        await selectConfiguration(page, 'Node.js: Current file');
        await page.locator('#ingot-tb-debug').click();
        await expect(page.locator('.theia-debug-top-stack-frame-line')).toBeVisible({ timeout: SESSION_TIMEOUT_MS });
        await expect(page.locator('#ingot-tb-debug-controls')).toBeVisible();
        await expect(page.locator('#ingot-tb-dbg-continue')).toBeVisible();
        await expect(page.locator('.theia-debug-console-variable', { hasText: 'total' }).first()).toBeVisible();
        await page.locator('#ingot-tb-dbg-step-over').click();
        await expect(page.locator('.theia-debug-top-stack-frame-line')).toBeVisible();
        await page.locator('#ingot-tb-stop').click();
        await expect(page.locator('#ingot-tb-debug-controls')).toBeHidden({ timeout: SESSION_TIMEOUT_MS });
    });
});
