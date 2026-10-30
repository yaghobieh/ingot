import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { setAppearance } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/**
 * Chat scrolling: the composer stays put under a list that scrolls on its own; while a reply streams the list
 * follows the latest line only when the reader is at the bottom, never jumps when they scrolled up, shows a
 * "Jump to latest" pill then, and the last line is never hidden behind the review bar or composer.
 */
const SHOTS_DIR = process.env.INGOT_SHOTS_DIR;
const PROMPT = 'Write a long answer';
const LINES = 160;
const answer = (): string => Array.from({ length: LINES }, (_, i) => `Paragraph ${i + 1} of the long answer, streamed a little at a time.`).join('\n\n');

/** Distance from the bottom after layout and the follow callbacks of the next frames have run. */
const fromBottom = (page: Page): Promise<number> => page.locator('.ingot-agents-chat').evaluate(el => new Promise<number>(resolve =>
    requestAnimationFrame(() => requestAnimationFrame(() => resolve(Math.round(el.scrollHeight - el.scrollTop - el.clientHeight))))));
/**
 * Distances from the bottom each time the reply grows, read after the panel's own resize observer ran
 * (observers are called in creation order), so they are what the frame paints.
 */
const growthSamples = (page: Page, ms: number): Promise<number[]> => page.locator('.ingot-agents-chat').evaluate((el, wait) => new Promise<number[]>(resolve => {
    const samples: number[] = [];
    const observer = new ResizeObserver(() => samples.push(Math.round(el.scrollHeight - el.scrollTop - el.clientHeight)));
    observer.observe(el.querySelector('.ingot-agents-thread')!);
    setTimeout(() => { observer.disconnect(); resolve(samples.slice(1)); }, wait);
}), ms);
const scrollTop = (page: Page): Promise<number> => page.locator('.ingot-agents-chat').evaluate(el => Math.round(el.scrollTop));
const top = async (page: Page, selector: string): Promise<number> => Math.round((await page.locator(selector).boundingBox())!.y);
const streaming = (page: Page): Promise<boolean> => page.locator('#ingot-composer-stop').isVisible();

test.describe('agent chat scrolling', () => {
    let server: FakeOllama;

    test.beforeEach(async () => {
        server = await startFakeOllama((_system, user) => user.startsWith(PROMPT) ? answer() : 'ok', { delayMs: 40, chunkSize: 24 });
    });

    test.afterEach(async () => {
        await server.close();
    });

    test('follows from the bottom, holds still when scrolled up, jumps back with the pill', async ({ page }) => {
        test.setTimeout(120_000);
        await page.setViewportSize({ width: 1280, height: 800 });
        await openIngot(page);
        await dismissNotifications(page);
        await setAppearance(page, 'dark');
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await page.locator('#ingot-composer-input').fill(PROMPT);
        await page.locator('#ingot-composer-input').press('Enter');

        // The list overflows while the reply streams; it keeps the latest line in view and the composer never moves.
        await expect.poll(() => page.locator('.ingot-agents-chat').evaluate(el => el.scrollHeight > el.clientHeight + 300), { timeout: 30_000 }).toBe(true);
        const composerTop = await top(page, '.ingot-composer');
        const following = await growthSamples(page, 800);
        expect(following.length).toBeGreaterThan(3);
        expect(Math.max(...following)).toBeLessThanOrEqual(2);
        expect(await top(page, '.ingot-composer')).toBe(composerTop);
        expect(await streaming(page)).toBe(true);

        // Scrolled up: the reading position holds while text keeps arriving, and the pill offers the way back.
        await page.locator('.ingot-agents-chat').hover();
        await page.mouse.wheel(0, -500);
        await expect(page.locator('#ingot-jump-latest')).toBeVisible();
        const held = await scrollTop(page);
        const heightBefore = await page.locator('.ingot-agents-chat').evaluate(el => el.scrollHeight);
        await page.waitForTimeout(600);
        expect(await page.locator('.ingot-agents-chat').evaluate(el => el.scrollHeight)).toBeGreaterThan(heightBefore);
        expect(Math.abs(await scrollTop(page) - held)).toBeLessThanOrEqual(1);
        expect(await top(page, '.ingot-composer')).toBe(composerTop);
        if (SHOTS_DIR) {
            fs.mkdirSync(SHOTS_DIR, { recursive: true });
            await page.locator('.ingot-agents').screenshot({ path: path.join(SHOTS_DIR, 'chat-scroll-jump-pill-dark.png'), animations: 'disabled' });
        }
        // The pill floats over the list; it takes no room from it.
        const chat = (await page.locator('.ingot-agents-chat').boundingBox())!;
        const pill = (await page.locator('#ingot-jump-latest').boundingBox())!;
        expect(pill.y + pill.height).toBeLessThanOrEqual(chat.y + chat.height);

        // Jump to latest glides to the bottom and follows again while the reply is still streaming.
        await page.locator('#ingot-jump-latest').click();
        await expect.poll(() => fromBottom(page)).toBeLessThanOrEqual(2);
        await expect(page.locator('#ingot-jump-latest')).toHaveCount(0);
        expect(await streaming(page)).toBe(true);
        expect(Math.max(...await growthSamples(page, 600))).toBeLessThanOrEqual(2);

        // Done: the last line sits fully inside the list, above the composer.
        await expect(page.locator('#ingot-composer-stop')).toBeHidden({ timeout: 60_000 });
        await expect(page.locator('.ingot-chat-agent .ingot-md').last()).toContainText(`Paragraph ${LINES} of the long answer`);
        expect(await fromBottom(page)).toBeLessThanOrEqual(2);
        const last = (await page.locator('.ingot-chat-agent .ingot-md p').last().boundingBox())!;
        const list = (await page.locator('.ingot-agents-chat').boundingBox())!;
        expect(last.y + last.height).toBeLessThanOrEqual(list.y + list.height);
        expect(list.y + list.height).toBeLessThanOrEqual(await top(page, '.ingot-composer'));
        if (SHOTS_DIR) {
            await page.locator('.ingot-agents').screenshot({ path: path.join(SHOTS_DIR, 'chat-scroll-bottom-dark.png'), animations: 'disabled' });
        }
    });
});
