import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { FIXTURE_WORKSPACE } from '../src/e2e.consts';
import { openIngot, runCommand } from '../src/app.utils';

const DEMO_MARKER = 'reviewed by Ingot agent (demo)';
const MATH_FILE = path.join(FIXTURE_WORKSPACE, 'src', 'math.ts');
const MATH_ORIGINAL = fs.readFileSync(MATH_FILE, 'utf8');

// Accepting an agent edit is saved by auto-save; always restore the fixture.
test.afterEach(() => fs.writeFileSync(MATH_FILE, MATH_ORIGINAL));

const openMath = async (page: Page): Promise<void> => {
    await page.locator('#explorer-view-container .theia-TreeNode', { hasText: 'src' }).first().click();
    await page.locator('#explorer-view-container .theia-TreeNode', { hasText: 'math.ts' }).first().dblclick();
    await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('export');
};

test.describe('IDEA-27/28 Agents tool window', () => {
    test('creates an agent, sends a prompt and picks mode and model', async ({ page }) => {
        await openIngot(page);
        const panel = page.locator('#ingot-agents');
        await expect(panel).toBeVisible();
        await page.locator('#ingot-agents-new').click();
        await expect(panel.locator('.ingot-agent-item')).toHaveCount(1);
        await page.locator('#ingot-composer-mode').selectOption('plan');
        await page.locator('#ingot-composer-model').selectOption({ label: 'GPT-5' });
        await page.locator('#ingot-composer-input').fill('make addItem optimistic and add qty support');
        await page.keyboard.press('Enter');
        await expect(panel.locator('.ingot-chat-user')).toHaveText('make addItem optimistic and add qty support');
        await expect(panel.locator('.ingot-agent-item-title').first()).toHaveText('Make addItem optimistic and add qty support');
        await expect(panel.locator('.ingot-chat-system')).toContainText('No model is connected');
    });

    test('toolbar Agents button toggles the panel', async ({ page }) => {
        await openIngot(page);
        await expect(page.locator('#ingot-agents')).toBeVisible();
        await page.locator('#ingot-tb-agents').click();
        await page.locator('#ingot-tb-agents').click();
        await expect(page.locator('#ingot-agents')).toBeVisible();
    });
});

test.describe('IDEA-29 inline agent edit review', () => {
    test('shows red/green diff with a floating bar; Ctrl+N rejects and Ctrl+Y accepts', async ({ page }) => {
        await openIngot(page);
        await openMath(page);

        await runCommand(page, 'Try Agent Edit Review (demo)');
        const bar = page.locator('.ingot-agent-edit-bar');
        await expect(bar).toBeVisible();
        await expect(bar).toContainText('Agent edit');
        await expect(bar).toContainText('math.ts');
        await expect(page.locator('.ingot-diff-added-line').first()).toBeVisible();
        await expect(page.locator('.ingot-diff-removed-zone').first()).toBeVisible();
        await expect(page.locator('#ingot-agents .ingot-chat-plan')).toBeVisible();
        await expect(page.locator('#ingot-agents .ingot-chat-changes')).toContainText('1 file changed');
        await expect(page.locator('#theia-statusBar')).toContainText('1 agent active');

        await page.locator('.monaco-editor').first().click();
        await page.keyboard.press('Control+n');
        await expect(bar).toBeHidden();
        await expect(page.locator('.monaco-editor .view-lines').first()).not.toContainText(DEMO_MARKER);

        await runCommand(page, 'Try Agent Edit Review (demo)');
        await expect(bar).toBeVisible();
        await page.locator('.monaco-editor').first().click();
        await page.keyboard.press('Control+y');
        await expect(bar).toBeHidden();
        await expect(page.locator('.monaco-editor .view-lines').first()).toContainText(DEMO_MARKER);
        await page.locator('#ingot-agents-tab-history').click();
        await expect(page.locator('#ingot-agents .ingot-agent-status.ingot-status-done').first()).toBeVisible();
    });
});
