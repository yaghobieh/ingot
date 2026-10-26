import * as fs from 'fs';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama } from '../src/fake-ollama';
import { makeImageProject } from '../src/image-fixtures';
import { connectOllama } from '../src/models.e2e-utils';

const preview = (page: Page) => page.locator('.ingot-image-preview:visible');
const status = (page: Page) => page.locator('#status-bar-ingot-image-info');
const tree = (page: Page) => page.locator('#files');

const openFile = async (page: Page, folder: string, name: string): Promise<void> => {
    await page.locator('#files').click();
    const folderNode = tree(page).locator('.theia-TreeNode', { hasText: folder }).first();
    const file = tree(page).locator('.theia-TreeNode', { hasText: name }).first();
    if (!await file.isVisible()) {
        await folderNode.click();
    }
    await file.dblclick();
};

test.describe('IDEA-145 image preview', () => {
    let dir: string;
    test.beforeEach(async ({ page }) => {
        dir = makeImageProject();
        await openIngot(page, dir);
        await dismissNotifications(page);
    });
    test.afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    test('PNG opens in the preview: zoom, Fit / 100%, checkerboard, size in the status bar (light and dark)', async ({ page }) => {
        await openFile(page, 'assets', 'logo.png');
        await expect(preview(page)).toBeVisible();
        const img = preview(page).locator('.ingot-image-canvas img');
        await expect.poll(() => img.evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(64);
        await expect(status(page)).toContainText('64 × 32');
        await expect(status(page)).toContainText('B');
        // Small images fit at 100% (never enlarged); zoom steps and the keyboard work.
        await expect(page.locator('#ingot-image-zoom')).toHaveText('100%');
        await page.locator('#ingot-image-zoom-in').click();
        await expect(page.locator('#ingot-image-zoom')).toHaveText('125%');
        await expect.poll(() => img.evaluate(el => (el as HTMLImageElement).width)).toBe(80);
        await page.locator('#ingot-image-zoom-in').click();
        await page.locator('#ingot-image-zoom-in').click();
        await expect(page.locator('#ingot-image-zoom')).toHaveText('200%');
        await expect(status(page)).toContainText('200%');
        await shot(page, 'image-preview-dark-zoom.png');
        await page.locator('#ingot-image-actual').click();
        await expect(page.locator('#ingot-image-zoom')).toHaveText('100%');
        await preview(page).press('-');
        await expect(page.locator('#ingot-image-zoom')).toHaveText('90%');
        await page.locator('#ingot-image-fit').click();
        await expect(page.locator('#ingot-image-zoom')).toHaveText('100%');
        // Transparent pixels sit on a checkerboard.
        expect(await preview(page).locator('.ingot-image-canvas').evaluate(el => getComputedStyle(el).backgroundImage)).toContain('linear-gradient');
        for (const mode of ['light', 'dark'] as const) {
            await setAppearance(page, mode);
            await preview(page).locator('#ingot-image-actual').click();
            for (let i = 0; i < 5; i++) {
                await page.locator('#ingot-image-zoom-in').click();
            }
            await shot(page, `image-preview-${mode}.png`);
        }
        // Leaving the preview clears its status entry.
        await openFile(page, 'src', 'app.ts');
        await expect(status(page)).toHaveCount(0);
    });

    test('SVG: preview updates live while editing the code side by side; Code and Open Preview switch views', async ({ page }) => {
        await openFile(page, 'assets', 'icon.svg');
        await expect(preview(page)).toBeVisible();
        await expect(status(page)).toContainText('40 × 20');
        await expect(page.locator('#ingot-image-mode-preview')).toHaveAttribute('aria-selected', 'true');
        await page.locator('#ingot-image-mode-split').click();
        const editor = page.locator('.theia-editor .monaco-editor').filter({ hasText: 'svg' }).first();
        await expect(editor).toBeVisible();
        await expect(preview(page)).toBeVisible();
        // Edit without saving: the preview follows the text.
        await editor.locator('.view-line', { hasText: 'width="40"' }).first().click();
        await page.keyboard.press('Control+H');
        const find = page.locator('.find-widget .find-part textarea, .find-widget .find-part input').first();
        await find.fill('width="40" height="20"');
        const replace = page.locator('.find-widget .replace-part textarea, .find-widget .replace-part input').first();
        await replace.fill('width="120" height="60"');
        await page.keyboard.press('Control+Alt+Enter');
        await page.keyboard.press('Escape');
        await expect.poll(() => preview(page).locator('.ingot-image-canvas img').evaluate(el => (el as HTMLImageElement).naturalWidth)).toBe(120);
        await preview(page).click();
        await expect(status(page)).toContainText('120 × 60');
        await shot(page, 'image-preview-svg-split-dark.png');
        // Code: the preview gives way to the editor; the editor toolbar brings the preview back.
        await page.locator('#ingot-image-mode-code').click();
        await expect(preview(page)).toHaveCount(0);
        await editor.click();
        await page.locator('#theia-main-content-panel .codicon-open-preview:visible').first().click();
        await expect(preview(page)).toBeVisible();
    });

    test('hovering an image path shows a thumbnail in code and in chat', async ({ page }) => {
        test.setTimeout(150_000);
        await openFile(page, 'src', 'app.ts');
        const token = page.locator('.monaco-editor .view-line span', { hasText: 'logo.png' }).first();
        await expect(token).toBeVisible();
        await token.hover();
        const hover = page.locator('.monaco-hover:not(.hidden)');
        const hoverImg = hover.locator('img').first();
        await expect(hoverImg).toBeVisible({ timeout: 15_000 });
        expect(await hoverImg.getAttribute('src')).toMatch(/^data:image\/png;base64,/);
        await expect(hover).toContainText('logo.png');
        await shot(page, 'image-hover-code-dark.png');
        await page.mouse.move(5, 5);

        const server = await startFakeOllama(() => 'The logo lives in `assets/logo.png`.', { delayMs: 0 });
        try {
            await connectOllama(page, server);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            await page.locator('#ingot-composer-input').fill('where is the logo?');
            await page.locator('#ingot-composer-input').press('Enter');
            const code = page.locator('#ingot-agents .ingot-md code', { hasText: 'assets/logo.png' }).last();
            await expect(code).toBeVisible({ timeout: 30_000 });
            await code.hover();
            await expect(page.locator('#ingot-image-hover')).toBeVisible();
            await expect(page.locator('#ingot-image-hover img')).toHaveAttribute('src', /^data:image\/png;base64,/);
            await expect(page.locator('#ingot-image-hover')).toContainText('logo.png');
            await shot(page, 'image-hover-chat-dark.png');
            await page.mouse.move(5, 5);
            await expect(page.locator('#ingot-image-hover')).toBeHidden();
        } finally {
            await server.close();
        }
    });
});
