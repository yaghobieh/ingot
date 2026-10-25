import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/** IDEA-98: open chats as one row of tabs with a right-click menu; no stacked chat list, no "New chat" titles. */
const agents = (page: Page) => page.locator('#ingot-agents');
const tabs = (page: Page) => agents(page).locator('.ingot-chat-tab');
const composer = (page: Page) => page.locator('#ingot-composer-input');

const send = async (page: Page, text: string): Promise<void> => {
    await composer(page).fill(text);
    await composer(page).press('Enter');
};

const tabMenu = async (page: Page, index: number, item: string): Promise<void> => {
    await tabs(page).nth(index).click({ button: 'right' });
    await page.locator(`#ingot-tab-menu-${item}`).click();
};

test.describe('IDEA-98 chat tabs', () => {
    let server: FakeOllama;
    let project: string;

    test.beforeEach(async () => {
        project = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-tabs-')));
        server = await startFakeOllama((_s, user) => `Echo: ${user.slice(0, 30)}`);
    });
    test.afterEach(async () => {
        await server.close();
        fs.rmSync(project, { recursive: true, force: true });
    });

    test('one row of tabs; untitled until a few words; rename, pin, close others, delete', async ({ page }) => {
        await openIngot(page, project);
        await dismissNotifications(page);
        await connectOllama(page, server);
        // No stacked chat cards and no "Agents" / "History" text sections.
        await expect(agents(page).locator('.ingot-agents-list')).toHaveCount(0);
        await expect(page.locator('#ingot-agents-tab-agents, #ingot-agents-tab-history')).toHaveCount(0);

        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        const active = agents(page).locator('.ingot-chat-tab.active');
        await expect(active).toHaveClass(/untitled/);
        await expect(agents(page).getByText('New chat', { exact: true })).toHaveCount(0);
        // Live name after a few words.
        await composer(page).fill('refactor the cart total rounding');
        await expect(active.locator('.ingot-chat-tab-title')).toHaveText('Refactor the cart total rounding');
        await composer(page).press('Enter');
        await expect(agents(page).locator('.ingot-chat-agent')).toContainText('Echo:');

        await page.locator('#ingot-agents-new').click();
        await send(page, 'second chat about auth tokens');
        await page.locator('#ingot-agents-new').click();
        await send(page, 'third chat about billing pages');
        await expect(tabs(page)).toHaveCount(3);

        // One horizontal row.
        const boxes = await Promise.all([0, 1, 2].map(i => tabs(page).nth(i).boundingBox()));
        expect(new Set(boxes.map(b => Math.round(b!.y))).size).toBe(1);

        // Rename (menu), Pin moves the tab to the front with a pin and no close button.
        await tabMenu(page, 2, 'rename');
        await agents(page).locator('.ingot-chat-tab-rename').fill('Billing');
        await agents(page).locator('.ingot-chat-tab-rename').press('Enter');
        await expect(tabs(page).nth(2).locator('.ingot-chat-tab-title')).toHaveText('Billing');
        await tabMenu(page, 2, 'pin');
        await expect(tabs(page).first()).toHaveClass(/pinned/);
        await expect(tabs(page).first().locator('.ingot-chat-tab-pin')).toBeVisible();
        await expect(tabs(page).first().locator('.ingot-chat-tab-close')).toHaveCount(0);

        // IDEA-104: pinned tabs stay first in pin order; unpinning goes to the first unpinned slot.
        const titles = () => tabs(page).locator('.ingot-chat-tab-title').allTextContents();
        await tabMenu(page, 2, 'pin');
        await expect.poll(titles).toEqual(['Billing', 'Second chat about auth tokens', 'Refactor the cart total rounding']);
        await expect(tabs(page).nth(1)).toHaveClass(/pinned/);
        await tabMenu(page, 0, 'pin');
        await expect.poll(titles).toEqual(['Second chat about auth tokens', 'Billing', 'Refactor the cart total rounding']);
        await expect(tabs(page).nth(1)).not.toHaveClass(/pinned/);
        await tabMenu(page, 1, 'pin');
        await tabMenu(page, 0, 'pin');
        await expect.poll(titles).toEqual(['Billing', 'Second chat about auth tokens', 'Refactor the cart total rounding']);
        await expect(tabs(page).first()).toHaveClass(/pinned/);
        await expect(tabs(page).nth(1)).not.toHaveClass(/pinned/);
        // Wider titles with the full title on hover.
        await expect(tabs(page).nth(2)).toHaveAttribute('title', 'Refactor the cart total rounding');
        const title = tabs(page).nth(2).locator('.ingot-chat-tab-title');
        expect(await title.evaluate(el => el.scrollWidth <= el.clientWidth)).toBe(true);

        // Middle-click closes; Close Others keeps the pinned tab.
        await tabs(page).filter({ hasText: 'Refactor' }).click({ button: 'middle' });
        await expect(tabs(page)).toHaveCount(2);
        await page.locator('#ingot-agents-history').click();
        await page.locator('#ingot-chat-history .ingot-history-row', { hasText: 'Refactor' }).click();
        await expect(tabs(page)).toHaveCount(3);
        await tabMenu(page, 2, 'close-others');
        await expect(tabs(page)).toHaveCount(2);
        await expect(tabs(page).first().locator('.ingot-chat-tab-title')).toHaveText('Billing');

        // Delete asks first.
        await tabMenu(page, 1, 'delete');
        await page.locator('.dialogOverlay .theia-button.main').click();
        await expect(tabs(page)).toHaveCount(1);

        // Pins and names survive a reload.
        await page.waitForTimeout(500);
        await page.reload();
        await expect(tabs(page).first().locator('.ingot-chat-tab-title')).toHaveText('Billing', { timeout: 60_000 });
        await expect(tabs(page).first()).toHaveClass(/pinned/);
        if (process.env.SHOTS_DIR) {
            await page.screenshot({ path: path.join(process.env.SHOTS_DIR, 'chat-tabs.png') });
        }
    });

    test('IDEA-120: a tab whose chat fills the context window gets a red underline; + and History stay', async ({ page }) => {
        await openIngot(page, project);
        await dismissNotifications(page);
        await connectOllama(page, server);
        await expect(page.locator('#ingot-agents-new')).toBeVisible();
        await expect(page.locator('#ingot-agents-history')).toBeVisible();
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await send(page, 'short question about the cart');
        const active = agents(page).locator('.ingot-chat-tab.active');
        await expect(agents(page).locator('.ingot-chat-agent')).toContainText('Echo:');
        await expect(active).not.toHaveClass(/context-full/);
        // The local model has a 32k-token window (~4 characters a token): one huge message fills it.
        await send(page, `fill the context ${'lorem ipsum dolor sit amet '.repeat(5000)}`);
        await expect(active).toHaveClass(/context-full/, { timeout: 30_000 });
        const underline = await active.evaluate(el => getComputedStyle(el, '::after').backgroundColor);
        expect(underline).toBe('rgb(229, 72, 77)');
        await expect(active).not.toHaveAttribute('title', 'New chat');
    });
});
