import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot, runCommand } from '../src/app.utils';
import { RULES_MONOREPO } from '../src/rules-insight.e2e-consts';
import { shootLightAndDark } from '../src/rules-insight.e2e-utils';

const problems = (page: Page) => page.locator('#problems');
const DEAD_GLOB = 'Glob "legacy/**/*.js" matches no files';

test.describe('IDEA-317 Rules Doctor', () => {
    test('reports conflicts, dead globs, shadowed rules, overrides and schema problems in the Problems view', async ({ page }) => {
        await openIngot(page, RULES_MONOREPO);
        await dismissNotifications(page);
        await runCommand(page, 'Run Rules Doctor');

        await expect(problems(page)).toBeVisible();
        await expect(problems(page)).toContainText(DEAD_GLOB);
        await expect(problems(page)).toContainText('"Use double quotes for strings." contradicts "Use single quotes for strings."');
        await expect(problems(page)).toContainText('"style" never loads: .ingot/rules/style.md has the same name and wins.');
        await expect(problems(page)).toContainText('"Use spaces for indentation." overrides "Use tabs for indentation."');
        await expect(problems(page)).toContainText('Unknown key "comand". Did you mean "command"?');
        await expect(problems(page)).toContainText('Needs "command" or "url".');
        await expect(page.locator('.theia-notification-list-item').filter({ hasText: 'Rules Doctor:' }).first()).toContainText(/always-on \d+ \/ 4k tokens/);

        // A finding opens its rule file at the offending glob.
        await problems(page).getByText(DEAD_GLOB).dblclick();
        await expect(page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: 'legacy.md' })).toBeVisible();
        await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('legacy/**/*.js');
        await dismissNotifications(page);
        await shootLightAndDark(page, 'rules-doctor');
    });

    test('re-runs on its own when the project changes, and from its shortcut', async ({ page }) => {
        const copy = fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-doctor-'));
        fs.cpSync(RULES_MONOREPO, copy, { recursive: true });
        try {
            await openIngot(page, copy);
            await dismissNotifications(page);
            await page.locator('#files').click();
            await page.keyboard.press('Control+Alt+Shift+D');
            await expect(problems(page)).toContainText(DEAD_GLOB);

            // A file the glob matches makes the finding go away without running the doctor again.
            fs.mkdirSync(path.join(copy, 'legacy'), { recursive: true });
            fs.writeFileSync(path.join(copy, 'legacy', 'app.js'), 'export const legacy = true;\n');
            fs.writeFileSync(path.join(copy, '.ingot', 'rules', 'legacy.md'), '---\nglobs: ["legacy/**/*.js"]\n---\n- Never add new jQuery code here.\n');
            await expect(problems(page)).not.toContainText(DEAD_GLOB, { timeout: 30_000 });
            await expect(problems(page)).toContainText('Unknown key "comand"');
        } finally {
            fs.rmSync(copy, { recursive: true, force: true });
        }
    });
});
