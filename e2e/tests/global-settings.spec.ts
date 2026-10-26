import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot, runCommand } from '../src/app.utils';
import { E2E_CONFIG_DIR } from '../src/e2e.consts';

const GLOBAL = path.join(E2E_CONFIG_DIR, 'ingot.settings.json');
const LONG_LINE = `export const long = '${'wrap me at the window edge '.repeat(40)}';\n`;
const editor = (page: Page) => page.locator('.theia-editor .monaco-editor').first();

/** IDEA-94: word wrap at the viewport by default; ~/.ingot/ingot.settings.json is read as user settings, live. */
test.describe('IDEA-94 word wrap and global settings', () => {
    let project: string;
    test.beforeEach(() => {
        fs.rmSync(GLOBAL, { force: true });
        project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-global-settings-')));
        fs.writeFileSync(path.join(project, 'long.ts'), LONG_LINE);
    });
    test.afterEach(() => {
        fs.rmSync(GLOBAL, { force: true });
        fs.rmSync(project, { recursive: true, force: true });
    });

    test('a long line wraps (no horizontal scroll); the global file applies live and its Open command creates it', async ({ page }) => {
        await openIngot(page, project);
        await dismissNotifications(page);
        await page.locator('#explorer-view-container .theia-TreeNode', { hasText: 'long.ts' }).first().dblclick();
        await expect(editor(page)).toBeVisible();
        // One model line shows as several view lines, and nothing scrolls sideways.
        await expect.poll(() => editor(page).locator('.view-line').count()).toBeGreaterThan(2);
        const lines = await editor(page).locator('.view-lines').first().evaluate(el => el.getBoundingClientRect().width);
        const box = (await editor(page).boundingBox())!;
        expect(lines).toBeLessThanOrEqual(box.width);
        await expect(editor(page).locator('.line-numbers').first()).toBeVisible();

        // Edit the global file on disk: the editor follows without a reload.
        fs.writeFileSync(GLOBAL, JSON.stringify({ 'editor.lineNumbers': 'off' }, undefined, 4));
        await expect(editor(page).locator('.line-numbers')).toHaveCount(0, { timeout: 20_000 });
        fs.writeFileSync(GLOBAL, JSON.stringify({ 'editor.wordWrap': 'off' }, undefined, 4));
        await expect(editor(page).locator('.line-numbers').first()).toBeVisible({ timeout: 20_000 });
        await expect.poll(() => editor(page).locator('.view-line').count(), { timeout: 20_000 }).toBe(2);

        // Open Global Settings (JSON) creates the file from the template when it is missing.
        fs.rmSync(GLOBAL, { force: true });
        await runCommand(page, 'Preferences: Open Global Settings (JSON)');
        await expect(page.locator('.lm-TabBar-tab', { hasText: 'ingot.settings.json' })).toBeVisible();
        await expect.poll(() => fs.existsSync(GLOBAL)).toBe(true);
        expect(fs.readFileSync(GLOBAL, 'utf8')).toContain('"ingot.appearance": "system"');
        expect(fs.readFileSync(GLOBAL, 'utf8')).not.toMatch(/sk-|api[-_]?key"\s*:/i);
    });

    test('a secret-looking key in the global file shows a Keychain warning (the value is never shown)', async ({ page }) => {
        fs.writeFileSync(GLOBAL, JSON.stringify({ 'models.apiKey': 'not-a-real-value' }, undefined, 4));
        await openIngot(page, project);
        const toast = page.locator('.theia-notification-list-item').filter({ hasText: 'like a secret' }).first();
        await expect(toast).toBeVisible({ timeout: 30_000 });
        await expect(toast).toContainText('models.apiKey');
        await expect(toast).not.toContainText('not-a-real-value');
    });
});
