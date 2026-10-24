import { execFileSync } from 'child_process';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { FIXTURE_WORKSPACE } from '../src/e2e.consts';

// Playwright's Desktop Chrome reports Windows, so the IntelliJ Windows/Linux keymap applies.
const SRC = path.join(FIXTURE_WORKSPACE, 'src');
const editorTab = (page: Page, label: string) => page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: label });
const activeTab = (page: Page) => page.locator('#theia-main-content-panel .lm-TabBar-tab.lm-mod-current.theia-mod-active, #theia-main-content-panel .lm-TabBar-tab.lm-mod-current').first();
const lines = (page: Page) => page.locator('#theia-main-content-panel .monaco-editor .view-lines').first();
const quickInput = (page: Page) => page.locator('.quick-input-widget .quick-input-box input');
const quickOptions = (page: Page) => page.locator('.quick-input-widget .monaco-list-row');
const cursor = (page: Page) => page.locator('#theia-statusBar [id$="editor-status-cursor-position"]');

/** Go to File (Ctrl+Shift+N) like a user: type the name, Enter. */
const goToFile = async (page: Page, name: string): Promise<void> => {
    await actUntilVisible(() => page.keyboard.press('Control+Shift+N'), quickInput(page));
    await page.keyboard.type(name);
    await quickOptions(page).filter({ hasText: name }).first().click();
    await expect(editorTab(page, name)).toBeVisible();
};

const focusEditor = async (page: Page): Promise<void> => {
    await lines(page).click();
};

test.describe('IDEA-17-24 IntelliJ keymap, navigation, find/replace and run', () => {
    test.afterEach(() => {
        execFileSync('git', ['checkout', '--', SRC], { cwd: FIXTURE_WORKSPACE });
    });

    test('double Shift searches everywhere; Ctrl+Shift+N, Ctrl+E and tab shortcuts navigate files', async ({ page }) => {
        await openIngot(page);
        await page.locator('#files').click();
        // Double Shift → Search Everywhere.
        await actUntilVisible(async () => { await page.keyboard.press('Shift'); await page.keyboard.press('Shift'); }, quickInput(page));
        await page.keyboard.type('math');
        await expect(quickOptions(page).first()).toContainText('math.ts');
        await page.keyboard.press('Enter');
        await expect(editorTab(page, 'math.ts')).toBeVisible();

        await goToFile(page, 'app.ts');
        await expect(activeTab(page)).toContainText('app.ts');

        // Recent Files (Ctrl+E): the previous file comes first, so Ctrl+E, Enter switches back.
        await focusEditor(page);
        await actUntilVisible(() => page.keyboard.press('Control+E'), page.locator('.quick-input-widget').getByText('Recent Files'));
        await expect(quickOptions(page).first()).toContainText('math.ts');
        await page.keyboard.press('Enter');
        await expect(activeTab(page)).toContainText('math.ts');

        // Tabs: Alt+Right / Alt+Left select next/previous, Ctrl+F4 closes.
        await focusEditor(page);
        await page.keyboard.press('Alt+ArrowRight');
        await expect(activeTab(page)).toContainText('app.ts');
        await page.keyboard.press('Alt+ArrowLeft');
        await expect(activeTab(page)).toContainText('math.ts');
        await page.keyboard.press('Control+F4');
        await expect(editorTab(page, 'math.ts')).toHaveCount(0);
    });

    test('Ctrl+G goes to a line and Ctrl+Shift+E lists recent locations', async ({ page }) => {
        await openIngot(page);
        await goToFile(page, 'math.ts');
        await focusEditor(page);
        await page.keyboard.press('Control+G');
        await expect(page.locator('.quick-input-widget')).toBeVisible();
        await page.keyboard.type('9');
        await page.keyboard.press('Enter');
        await expect(cursor(page)).toHaveText(/^9:/);

        await goToFile(page, 'app.ts');
        await focusEditor(page);
        await actUntilVisible(() => page.keyboard.press('Control+Shift+E'), page.locator('.quick-input-widget').getByText('Recent Locations'));
        const mathLine = quickOptions(page).filter({ hasText: 'math.ts:9' });
        await expect(mathLine).toContainText("GREETING = 'hello ingot'");
        await mathLine.click();
        await expect(activeTab(page)).toContainText('math.ts');
        await expect(cursor(page)).toHaveText(/^9:/);
    });

    test('find and replace in the file (Ctrl+F / Ctrl+R) and IntelliJ editing keys', async ({ page }) => {
        await openIngot(page);
        await goToFile(page, 'math.ts');
        await focusEditor(page);

        await page.keyboard.press('Control+F');
        const find = page.locator('.monaco-editor .find-widget.visible');
        await expect(find).toBeVisible();
        await page.keyboard.type('a + b');
        await expect(find.locator('.matchesCount')).toContainText('1 of 1');
        await page.keyboard.press('Escape');

        await focusEditor(page);
        await page.keyboard.press('Control+R');
        await expect(find.locator('.replace-part')).toBeVisible();
        await find.getByRole('textbox', { name: 'Replace' }).fill('b + a');
        await find.getByRole('button', { name: /^Replace All/ }).click();
        await expect(lines(page)).toContainText('return b + a;');
        await page.keyboard.press('Escape');

        // Ctrl+D duplicates, Ctrl+Y deletes the line, Ctrl+/ comments it.
        await focusEditor(page);
        await page.keyboard.press('Control+End');
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('Control+D');
        await expect(lines(page)).toContainText("hello ingot';export const GREETING");
        await page.keyboard.press('Control+Y');
        await expect(lines(page)).not.toContainText("hello ingot';export const GREETING");
        await page.keyboard.press('ArrowUp');
        await page.keyboard.press('Control+/');
        await expect(lines(page)).toContainText("// export const GREETING");
    });

    test('find and replace in files (Ctrl+Shift+F / Ctrl+Shift+R)', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        await page.locator('#files').click();
        await actUntilVisible(() => page.keyboard.press('Control+Shift+F'), page.locator('#search-in-workspace'));
        const searchBox = page.locator('#search-input-field');
        await searchBox.fill('GREETING');
        const results = page.locator('#search-in-workspace .resultContainer');
        await expect(page.locator('#search-in-workspace')).toContainText('app.ts');
        await expect(page.locator('#search-in-workspace')).toContainText('math.ts');
        await expect(results.first()).toBeVisible();

        await page.keyboard.press('Control+Shift+R');
        await expect(page.locator('#replace-input-field')).toBeVisible();
    });

    test('Shift+F10 runs the dev script, Ctrl+F2 stops it, Shift+F9 debugs', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        await page.locator('#files').click();
        const runTab = page.locator('#theia-bottom-content-panel .lm-TabBar-tab', { hasText: 'Run: dev' });
        await actUntilVisible(() => page.keyboard.press('Shift+F10'), runTab);
        await page.keyboard.press('Control+F2');
        await page.locator('#files').click();
        const debugTab = page.locator('#theia-bottom-content-panel .lm-TabBar-tab', { hasText: 'Debug: dev' });
        await actUntilVisible(() => page.keyboard.press('Shift+F9'), debugTab);
        await expect(page.locator('.theia-notification-list-item').filter({ hasText: '--inspect' }).first()).toBeVisible();
        // The toolbar Run button uses the same configuration.
        await expect(page.locator('#ingot-tb-run-config')).toContainText('dev');
    });
});
