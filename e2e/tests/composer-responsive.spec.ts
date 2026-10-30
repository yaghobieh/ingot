import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/**
 * IDEA-188 / IDEA-248: in a narrow chat panel the inline controls stay inside the bar. Mode and the context
 * ring live in the overflow menu, so they stay clickable without crowding the text area.
 */
const BAR = '.ingot-agents .ingot-composer-bar';
const CONTROLS = ['#ingot-composer-attach', '#ingot-composer-more', '#ingot-composer-model', '#ingot-composer-send'];

const setComposerWidth = (page: Page, width?: number): Promise<void> =>
    page.locator('.ingot-agents .ingot-composer').evaluate((el, w) => {
        const node = el as HTMLElement;
        node.style.width = w ? `${w}px` : '';
        node.style.boxSizing = w ? 'border-box' : '';
    }, width);

/** Every inline control is fully inside the bar. */
const expectNothingClipped = async (page: Page): Promise<void> => {
    const bar = (await page.locator(BAR).boundingBox())!;
    for (const id of CONTROLS) {
        const control = page.locator(id);
        await expect(control, id).toBeVisible();
        const box = (await control.boundingBox())!;
        expect(box.x, `${id} left`).toBeGreaterThanOrEqual(bar.x - 1);
        expect(box.x + box.width, `${id} right`).toBeLessThanOrEqual(bar.x + bar.width + 1);
        expect(box.width, `${id} width`).toBeGreaterThanOrEqual(id === '#ingot-composer-model' ? 40 : 24);
    }
};

const closePopovers = async (page: Page): Promise<void> => {
    if (await page.locator('#ingot-context-popover').isVisible()) {
        await page.mouse.click(5, 5);
        await expect(page.locator('#ingot-context-popover')).toBeHidden();
    }
    if (await page.locator('#ingot-mode-menu').isVisible()) {
        await page.mouse.click(5, 5);
        await expect(page.locator('#ingot-mode-menu')).toBeHidden();
    }
    if (await page.locator('#ingot-composer-more-menu').isVisible()) {
        await page.locator('#ingot-composer-more').click();
        await expect(page.locator('#ingot-composer-more-menu')).toBeHidden();
    }
};

const openExtras = async (page: Page): Promise<void> => {
    await closePopovers(page);
    await page.locator('#ingot-composer-more').click();
    await expect(page.locator('#ingot-composer-more-menu')).toBeVisible();
    await expect(page.locator('#ingot-composer-mode .ingot-pill-label')).toBeVisible();
    await expect(page.locator('#ingot-composer-more')).toHaveAttribute('title', /^More · Mode: Agent/);
};

for (const scheme of ['light', 'dark'] as const) {
    test(`IDEA-188 composer toolbar fits narrow chat panels (${scheme})`, async ({ page }) => {
        test.setTimeout(120_000);
        await openIngot(page);
        await setAppearance(page, scheme);
        await dismissNotifications(page);
        const server = await startFakeOllama(() => 'Branches: one ticket, one branch.', { delayMs: 0 });
        try {
            await connectOllama(page, server);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            await page.locator('#ingot-composer-input').fill('how do branches work here');
            await page.locator('#ingot-composer-input').press('Enter');
            await expect(page.locator('.ingot-chat-agent .ingot-md').last()).toContainText('one branch');

            await setComposerWidth(page, 520);
            await expect(page.locator(BAR)).toHaveAttribute('data-width', 'wide');
            await expectNothingClipped(page);
            await openExtras(page);
            await expect(page.locator('#ingot-context-ring')).toBeVisible();
            await closePopovers(page);

            for (const [width, cls] of [[340, 'narrow'], [250, 'tiny']] as const) {
                await setComposerWidth(page, width);
                await expect(page.locator(BAR)).toHaveAttribute('data-width', cls);
                await expectNothingClipped(page);
                await shot(page, `composer-${cls}-${scheme}.png`);
                await openExtras(page);
                await page.locator('#ingot-context-ring').click();
                await expect(page.locator('#ingot-context-popover')).toBeVisible();
                await expect(page.locator('#ingot-context-popover #ingot-context-total')).toContainText('%');
                await shot(page, `composer-${cls}-context-${scheme}.png`);
                await page.mouse.click(5, 5);
                await expect(page.locator('#ingot-context-popover')).toBeHidden();
                await page.locator('#ingot-composer-mode').click();
                await expect(page.locator('#ingot-mode-menu')).toBeVisible();
                await page.mouse.click(5, 5);
                await expect(page.locator('#ingot-mode-menu')).toBeHidden();
            }
            await setComposerWidth(page);
            for (const [width, cls] of [[480, 'wide'], [360, 'narrow'], [280, 'tiny']] as const) {
                await setComposerWidth(page, width);
                await expect(page.locator(BAR)).toHaveAttribute('data-width', cls);
                await expectNothingClipped(page);
                await openExtras(page);
                await page.locator('#ingot-context-ring').click();
                await expect(page.locator('#ingot-context-popover')).toBeVisible();
                await page.mouse.click(5, 5);
                await expect(page.locator('#ingot-context-popover')).toBeHidden();
                await shot(page, `composer-${width}-${scheme}.png`);
            }
            await setComposerWidth(page);
        } finally {
            await server.close();
        }
    });
}
