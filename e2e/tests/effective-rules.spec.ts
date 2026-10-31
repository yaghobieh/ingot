import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot, runCommand } from '../src/app.utils';
import { RULES_MONOREPO } from '../src/rules-insight.e2e-consts';
import { openFile, shootLightAndDark } from '../src/rules-insight.e2e-utils';

const view = (page: Page) => page.locator('#ingot-effective-rules');
const entry = (page: Page, name: string) => view(page).locator('.ingot-er-entry', { hasText: name });
const fileInput = (page: Page) => view(page).getByRole('combobox', { name: 'File' });

test.describe('IDEA-327 Monorepo effective-rules view', () => {
    test('merges root, package and folder rules for a file, with override markers', async ({ page }) => {
        await openIngot(page, RULES_MONOREPO);
        await dismissNotifications(page);
        await openFile(page, 'packages/web/src/components/Button.tsx', 'export const Button');
        await runCommand(page, 'Show Effective Rules for File');

        await expect(view(page)).toBeVisible();
        await expect(fileInput(page)).toHaveValue('packages/web/src/components/Button.tsx');
        await expect(view(page).locator('.ingot-er-layer-chip')).toHaveText(['Root', 'Package packages/web/', 'Folder packages/web/src/components/']);

        // The package's style rule replaces the root one; the root rule shows who overrides it.
        const rootStyle = view(page).locator('.ingot-er-status-overridden');
        await expect(rootStyle).toContainText('style');
        await expect(rootStyle.locator('.ingot-er-marker-down')).toContainText('overridden by packages/web/style');
        await expect(view(page).locator('.ingot-er-marker-up')).toContainText('overrides style');
        // A deeper folder contradicts one line of a root rule.
        await expect(view(page).locator('.ingot-er-line').filter({ hasText: 'Use named exports.' })).toContainText('Use default exports for components.');
        // Same-folder contradictions, shadowed and non-matching rules.
        await expect(view(page).locator('.ingot-er-conflict').first()).toContainText('single quotes');
        await expect(view(page).locator('.ingot-er-status-shadowed')).toContainText('shadowed');
        await expect(view(page).locator('.ingot-er-status-not-matching')).toContainText('legacy');
        await expect(view(page).locator('.ingot-er-status-applied').filter({ hasText: 'packages/web/AGENTS.md' })).toContainText('Closest AGENTS.md');

        await view(page).getByRole('button', { name: 'Merged instructions' }).click();
        const merged = view(page).locator('.ingot-er-merged-text');
        await expect(merged).toContainText('MONO-WEB-AGENTS');
        await expect(merged).toContainText('Use spaces for indentation.');
        await expect(merged).not.toContainText('Use tabs for indentation.');
        await shootLightAndDark(page, 'effective-rules');
        await view(page).getByRole('button', { name: 'Merged instructions' }).click();

        // Another package: different layers and glob results.
        await fileInput(page).fill('packages/api/src/server.ts');
        await fileInput(page).press('Enter');
        await expect(view(page).locator('.ingot-er-layer-chip')).toHaveText(['Root', 'Package packages/api/']);
        await expect(view(page).locator('.ingot-er-status-applied').filter({ hasText: 'style' }).first()).toContainText('Always on.');
        await expect(view(page).locator('.ingot-er-status-not-matching').filter({ hasText: 'react' })).toBeVisible();
        await expect(entry(page, 'packages/web/style')).toHaveCount(0);
    });

    test('opens from the explorer context menu and its shortcut', async ({ page }) => {
        await openIngot(page, RULES_MONOREPO);
        await dismissNotifications(page);
        await page.locator('#files .theia-TreeNode', { hasText: /^AGENTS\.md$/ }).first().click({ button: 'right' });
        await page.locator('.lm-Menu-item', { hasText: 'Show Effective Rules' }).click();
        await expect(fileInput(page)).toHaveValue('AGENTS.md');
        await expect(view(page).locator('.ingot-er-layer-chip')).toHaveText(['Root']);

        await openFile(page, 'packages/web/src/App.tsx', 'export const App');
        await page.keyboard.press('Control+Alt+Shift+E');
        await expect(fileInput(page)).toHaveValue('packages/web/src/App.tsx');
        await expect(view(page).locator('.ingot-er-layer-chip')).toHaveText(['Root', 'Package packages/web/']);
    });
});
