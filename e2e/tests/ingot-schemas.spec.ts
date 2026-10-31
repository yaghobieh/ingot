import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot, runCommand } from '../src/app.utils';
import { RULES_MONOREPO } from '../src/rules-insight.e2e-consts';
import { openFile, shootLightAndDark } from '../src/rules-insight.e2e-utils';

const editor = (page: Page) => page.locator('.monaco-editor:not(.monaco-diff-editor .monaco-editor)').filter({ has: page.locator('.view-lines') }).last();
const suggestions = (page: Page) => page.locator('.monaco-editor .suggest-widget.visible');
const pickRows = (page: Page) => page.locator('.quick-input-widget .monaco-list-row');

test.describe('IDEA-321 .ingot schemas, completion, validation and glob preview', () => {
    let copy: string;

    test.beforeEach(() => {
        copy = fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-schemas-'));
        fs.cpSync(RULES_MONOREPO, copy, { recursive: true });
        fs.writeFileSync(path.join(copy, '.ingot', 'rules', 'new-rule.md'), '');
    });
    test.afterEach(() => { fs.rmSync(copy, { recursive: true, force: true }); });

    test('previews what each rule glob matches, inline, on hover and in a list', async ({ page }) => {
        await openIngot(page, copy);
        await dismissNotifications(page);
        await openFile(page, '.ingot/rules/react.md', 'function components');
        await expect(editor(page).locator('.view-lines')).toContainText('2 files');

        await editor(page).locator('.view-lines span', { hasText: '**/*.tsx' }).first().hover();
        const hover = page.locator('.monaco-hover:visible');
        await expect(hover).toContainText('matches 2 files');
        await expect(hover).toContainText('packages/web/src/App.tsx');
        await expect(hover).toContainText('packages/web/src/components/Button.tsx');
        await shootLightAndDark(page, 'glob-preview', async () => {
            await editor(page).locator('.view-lines span', { hasText: '**/*.tsx' }).first().hover();
            await expect(page.locator('.monaco-hover:visible')).toContainText('matches 2 files');
        });

        await editor(page).locator('.view-lines span', { hasText: '**/*.tsx' }).first().click();
        await page.keyboard.press('Control+Alt+Shift+G');
        await expect(pickRows(page).filter({ hasText: 'packages/web/src/App.tsx' })).toBeVisible();
        await expect(pickRows(page)).toHaveCount(2);
        await page.keyboard.press('Escape');

        await openFile(page, '.ingot/rules/legacy.md', 'jQuery');
        await expect(editor(page).locator('.view-lines')).toContainText('no files');
        await runCommand(page, 'Preview Glob Matches');
        await expect(page.locator('.quick-input-widget input')).toBeVisible();
        await page.locator('.quick-input-widget input').fill('packages/*/package.json');
        await page.keyboard.press('Enter');
        await expect(pickRows(page)).toHaveCount(2);
        await page.keyboard.press('Escape');
    });

    test('completes keys and values and flags schema problems as you type', async ({ page }) => {
        await openIngot(page, copy);
        await dismissNotifications(page);
        await openFile(page, '.ingot/rules/new-rule.md', '');

        // An empty rule offers the frontmatter template.
        await editor(page).locator('.view-lines').click();
        await page.keyboard.press('Control+Space');
        await expect(suggestions(page)).toContainText('Rule frontmatter');
        await page.keyboard.press('Enter');
        await expect(editor(page).locator('.view-lines')).toContainText('alwaysApply: false');

        // A typo is flagged live in the Problems view, with the right key suggested.
        await page.keyboard.press('Escape');
        await editor(page).locator('.view-line', { hasText: 'alwaysApply: false' }).click();
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await page.keyboard.type('alwaysAply: true');
        await runCommand(page, 'Problems');
        await expect(page.locator('#problems')).toContainText('Unknown key "alwaysAply". Did you mean "alwaysApply"?');
        await editor(page).locator('.view-line', { hasText: 'alwaysAply: true' }).click();
        await page.keyboard.press('End');
        await page.keyboard.press('Shift+Home');
        await page.keyboard.press('Backspace');
        await page.keyboard.press('Backspace');
        await expect(page.locator('#problems')).not.toContainText('alwaysAply');

        // Keys and project-based glob values complete inside the frontmatter.
        await page.keyboard.press('Control+Home');
        await page.keyboard.press('End');
        await page.keyboard.press('Enter');
        await page.keyboard.press('Control+Space');
        await expect(suggestions(page)).toContainText('pack');
        await page.keyboard.press('Escape');
        await page.keyboard.press('Backspace');
        await expect(editor(page).locator('.view-line').first()).toHaveText(/^---/);
        await editor(page).locator('.view-line', { hasText: 'globs:' }).click();
        await page.keyboard.press('End');
        await page.keyboard.press('Control+Space');
        await expect(suggestions(page)).toContainText('**/*.tsx');
        await page.keyboard.press('Escape');
        await page.keyboard.press('Control+s');

        // JSON files: unknown keys and missing required values.
        await openFile(page, '.ingot/mcp.json', 'mcpServers');
        await expect(page.locator('#problems')).toContainText('Unknown key "comand". Did you mean "command"?');
        await shootLightAndDark(page, 'ingot-schemas');
    });
});
