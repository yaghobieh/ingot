import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/**
 * IDEA-188: in a narrow chat panel the composer toolbar collapses instead of clipping: the mode pill keeps its
 * whole label or shows just its icon, nothing overflows the bar, and the context ring stays clickable.
 */
const BAR = '.ingot-agents .ingot-composer-bar';
const CONTROLS = ['#ingot-composer-attach', '#ingot-composer-mode', '#ingot-composer-model', '#ingot-context-ring', '#ingot-composer-send'];

const setComposerWidth = (page: Page, width?: number): Promise<void> =>
    page.locator('.ingot-agents .ingot-composer').evaluate((el, w) => {
        const node = el as HTMLElement;
        node.style.width = w ? `${w}px` : '';
        node.style.boxSizing = w ? 'border-box' : '';
    }, width);

/** Every control is fully inside the bar, at least as wide as it is tall (icons) and no label is cut off. */
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
    const mode = await page.locator('#ingot-composer-mode .ingot-pill-label').evaluate(el => {
        const label = el as HTMLElement;
        return { shown: getComputedStyle(label).display !== 'none', clipped: label.scrollWidth > label.clientWidth + 1 };
    });
    expect(mode.clipped, 'mode label is clipped').toBe(false);
    if (!mode.shown) {
        await expect(page.locator('#ingot-composer-mode .codicon').first()).toBeVisible();
    }
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
            await expect(page.locator('#ingot-context-ring')).toBeVisible();

            await setComposerWidth(page, 520);
            await expect(page.locator(BAR)).toHaveAttribute('data-width', 'wide');
            await expect(page.locator('#ingot-composer-mode .ingot-pill-label')).toBeVisible();
            await expectNothingClipped(page);

            for (const [width, cls] of [[340, 'narrow'], [250, 'tiny']] as const) {
                await setComposerWidth(page, width);
                await expect(page.locator(BAR)).toHaveAttribute('data-width', cls);
                await expect(page.locator('#ingot-composer-mode .ingot-pill-label')).toBeHidden();
                await expect(page.locator('#ingot-composer-mode')).toHaveAttribute('title', /^Mode: Agent/);
                await expectNothingClipped(page);
                await shot(page, `composer-${cls}-${scheme}.png`);

                // The ring opens its breakdown, and the mode menu still opens from the icon-only pill.
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
            for (const [width, cls, label] of [[480, 'wide', true], [360, 'narrow', false], [280, 'tiny', false]] as const) {
                await setComposerWidth(page, width);
                await expect(page.locator(BAR)).toHaveAttribute('data-width', cls);
                if (label) {
                    await expect(page.locator('#ingot-composer-mode .ingot-pill-label')).toBeVisible();
                } else {
                    await expect(page.locator('#ingot-composer-mode .ingot-pill-label')).toBeHidden();
                }
                await expectNothingClipped(page);
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
