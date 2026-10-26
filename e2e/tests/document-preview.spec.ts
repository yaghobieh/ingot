import * as fs from 'fs';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import { makeDocumentProject } from '../src/document-fixtures';

const tree = (page: Page) => page.locator('#files');
const mdPreview = (page: Page) => page.locator('.ingot-markdown-preview:visible');
const mdEditor = (page: Page) => page.locator('.theia-editor:visible .monaco-editor').filter({ hasText: 'Ingot Preview Demo' }).first();
const modeButton = (page: Page, icon: 'code' | 'open-preview' | 'split-horizontal') =>
    page.locator(`#theia-main-content-panel .p-TabBar-toolbar .codicon-${icon}:visible, #theia-main-content-panel .lm-TabBar-toolbar .codicon-${icon}:visible`).first();
const pdfViewer = (page: Page) => page.locator('.ingot-pdf-viewer:visible');
const pdfStatus = (page: Page) => page.locator('#status-bar-ingot-pdf-info');

const openFile = async (page: Page, name: string, folder?: string): Promise<void> => {
    await page.locator('#files').click();
    const file = tree(page).locator('.theia-TreeNode', { hasText: name }).first();
    if (folder && !await file.isVisible()) {
        await tree(page).locator('.theia-TreeNode', { hasText: folder }).first().click();
    }
    await file.dblclick();
};

/** The first source line naming a section (or the title) Monaco shows at the top, ignoring the sticky-scroll header and wrapped tails. */
const editorTopText = (page: Page) => mdEditor(page).evaluate(el => {
    const editorTop = el.getBoundingClientRect().top;
    const lines = Array.from(el.querySelectorAll<HTMLElement>('.view-lines .view-line'))
        .filter(line => !line.closest('.sticky-widget') && /section\s+\d+|Preview\s+Demo/i.test(line.textContent ?? '') && line.getBoundingClientRect().top >= editorTop - 2)
        .sort((a, b) => a.getBoundingClientRect().top - b.getBoundingClientRect().top);
    return lines[0]?.textContent ?? '';
});

test.describe('IDEA-146 Markdown and PDF previews', () => {
    let dir: string;
    test.beforeEach(async ({ page }) => {
        dir = makeDocumentProject();
        await openIngot(page, dir);
        await dismissNotifications(page);
    });
    test.afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    test('Markdown: Code / Preview / Side by side, live updates, scroll sync, tables, code, images and mermaid', async ({ page }) => {
        test.setTimeout(150_000);
        await openFile(page, 'README.md');
        await expect(mdEditor(page)).toBeVisible();
        await expect(modeButton(page, 'code')).toBeVisible();

        // Side by side: rendered blocks next to the source.
        await modeButton(page, 'split-horizontal').click();
        await expect(mdPreview(page)).toBeVisible();
        await expect(mdEditor(page)).toBeVisible();
        const body = mdPreview(page).locator('.ingot-mdp-body');
        await expect(body.locator('h1')).toHaveText('Ingot Preview Demo');
        await expect(body.locator('.ingot-mdp-table table td', { hasText: 'Mermaid' })).toBeVisible();
        await expect.poll(() => body.locator('img[alt="Logo"]').evaluate(el => (el as HTMLImageElement).naturalWidth), { timeout: 15_000 }).toBe(64);
        await expect(body.locator('.ingot-mdp-mermaid.rendered svg')).toBeVisible({ timeout: 30_000 });
        // Code blocks use the editor's grammar and colours (more than the default token class).
        await expect(body.locator('.ingot-mdp-code code span[class^="mtk"]:not(.mtk1)').first()).toBeVisible({ timeout: 15_000 });
        await expect(body.locator('.ingot-mdp-task.done')).toHaveCount(1);
        await expect(page.locator('#theia-main-content-panel .toggled .codicon-split-horizontal, #theia-main-content-panel .codicon-split-horizontal.toggled').first()).toBeVisible();
        for (const mode of ['light', 'dark'] as const) {
            await setAppearance(page, mode);
            await expect(body.locator('.ingot-mdp-mermaid.rendered svg')).toBeVisible({ timeout: 30_000 });
            await shot(page, `markdown-split-${mode}.png`);
        }

        // Live: typing updates the preview before saving.
        await mdEditor(page).locator('.view-line', { hasText: 'Ingot Preview Demo' }).first().click();
        await page.keyboard.press('End');
        await page.keyboard.type(' Live');
        await expect(body.locator('h1')).toHaveText('Ingot Preview Demo Live');

        // Scroll sync, editor to preview: the preview follows the editor down.
        const scroller = mdPreview(page).locator('.ingot-mdp-scroll');
        for (let i = 0; i < 5; i++) {
            await page.keyboard.press('PageDown');
        }
        await expect.poll(() => scroller.evaluate(el => el.scrollTop)).toBeGreaterThan(800);
        await page.waitForTimeout(300);
        const editorTop = await editorTopText(page);
        const sectionInEditor = Number(/section\s+(\d+)/i.exec(editorTop)?.[1] ?? 0);
        expect(sectionInEditor).toBeGreaterThan(0);
        const previewSection = await scroller.evaluate(el => {
            const top = el.getBoundingClientRect().top;
            const blocks = Array.from(el.querySelectorAll<HTMLElement>('[data-line]')).filter(b => b.getBoundingClientRect().bottom > top + 4);
            return blocks[0]?.textContent ?? '';
        });
        expect(Math.abs(Number(/section\s+(\d+)/i.exec(previewSection)?.[1] ?? 0) - sectionInEditor)).toBeLessThanOrEqual(1);

        // And back: scrolling the preview to the top brings the editor along.
        await scroller.hover();
        for (let i = 0; i < 12; i++) {
            await page.mouse.wheel(0, -600);
        }
        await expect.poll(() => editorTopText(page)).toMatch(/Ingot\s+Preview\s+Demo/);

        // Preview only, then Code only.
        await modeButton(page, 'open-preview').click();
        await expect(mdPreview(page)).toBeVisible();
        await expect(mdEditor(page)).toHaveCount(0);
        await shot(page, 'markdown-preview-dark.png');
        await setAppearance(page, 'light');
        await shot(page, 'markdown-preview-light.png');
        await setAppearance(page, 'dark');
        await mdPreview(page).click();
        await modeButton(page, 'code').click();
        await expect(mdEditor(page)).toBeVisible();
        await expect(page.locator('.ingot-markdown-preview')).toHaveCount(0);
        // The unsaved edit survived the round trip through the preview.
        await expect(mdEditor(page)).toContainText('Ingot Preview Demo Live');
    });

    test('PDF: pages, zoom, search and text selection in the built-in viewer', async ({ page }) => {
        test.setTimeout(120_000);
        await openFile(page, 'report.pdf', 'docs');
        await expect(pdfViewer(page)).toBeVisible();
        await expect(page.locator('#ingot-pdf-pages')).toHaveText('of 3', { timeout: 30_000 });
        const textLayer = pdfViewer(page).locator('.page[data-page-number="1"] .textLayer');
        await expect(textLayer).toContainText('Ingot quarterly report', { timeout: 30_000 });
        await expect(pdfStatus(page)).toContainText('Page 1 of 3');

        // Zoom: buttons and presets, reflected in the status bar.
        await page.locator('#ingot-pdf-zoom').selectOption('1');
        await expect(pdfStatus(page)).toContainText('100%');
        await page.locator('#ingot-pdf-zoom-in').click();
        await expect(pdfStatus(page)).toContainText('125%');
        await expect(page.locator('#ingot-pdf-zoom')).toHaveValue('1.25');
        await page.locator('#ingot-pdf-zoom-out').click();
        await page.locator('#ingot-pdf-zoom-out').click();
        await expect(pdfStatus(page)).toContainText('75%');

        // Pages: type a number, or step.
        await page.locator('#ingot-pdf-page').fill('3');
        await page.locator('#ingot-pdf-page').press('Enter');
        await expect(pdfStatus(page)).toContainText('Page 3 of 3');
        await page.locator('#ingot-pdf-prev').click();
        await expect(pdfStatus(page)).toContainText('Page 2 of 3');

        // Search: Ctrl/Cmd+F, live matches from the current page (2), Enter for the next one, wrapping around.
        await pdfViewer(page).locator('.ingot-pdf-container').click();
        await page.keyboard.press('ControlOrMeta+f');
        await expect(page.locator('#ingot-pdf-search')).toBeFocused();
        await page.keyboard.type('kiwi');
        await expect(page.locator('#ingot-pdf-matches')).toHaveText('2 of 3', { timeout: 15_000 });
        await expect(pdfViewer(page).locator('.textLayer .highlight').first()).toBeVisible();
        await page.keyboard.press('Enter');
        await expect(page.locator('#ingot-pdf-matches')).toHaveText('3 of 3');
        await expect(pdfStatus(page)).toContainText('Page 3 of 3');
        await page.keyboard.press('Enter');
        await expect(page.locator('#ingot-pdf-matches')).toHaveText('1 of 3');
        await page.locator('#ingot-pdf-search').fill('durian');
        await expect(page.locator('#ingot-pdf-matches')).toHaveText('No results', { timeout: 15_000 });
        await page.locator('#ingot-pdf-search').fill('kiwi');
        await expect(page.locator('#ingot-pdf-matches')).toHaveText(/of 3$/, { timeout: 15_000 });

        // Text selection works on the text layer.
        await page.locator('#ingot-pdf-page').fill('1');
        await page.locator('#ingot-pdf-page').press('Enter');
        const line = textLayer.locator('span', { hasText: 'Selectable text lives here.' }).first();
        await line.scrollIntoViewIfNeeded();
        await line.dblclick();
        expect(await page.evaluate(() => window.getSelection()?.toString().trim() ?? '')).not.toBe('');
        await line.click({ clickCount: 3 });
        await expect.poll(() => page.evaluate(() => window.getSelection()?.toString() ?? '')).toContain('Selectable text lives here.');

        for (const mode of ['light', 'dark'] as const) {
            await setAppearance(page, mode);
            await shot(page, `pdf-viewer-${mode}.png`);
        }
        // Leaving the viewer clears its status entry.
        await openFile(page, 'README.md');
        await expect(pdfStatus(page)).toHaveCount(0);
    });
});
