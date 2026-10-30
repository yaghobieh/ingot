import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { setAppearance, shot, tokenColor } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { saveArtifact } from '../src/artifacts.e2e-utils';

/** IDEA-248: Rex above the composer, one overflow menu, a distinct latest turn, jump, and edit-and-rerun. */

const saveShot = async (page: Page, name: string): Promise<void> => {
    await saveArtifact(page.locator('.ingot-agents'), name);
    await shot(page, name);
};

const lines = (label: string): string => Array.from({ length: 24 }, (_unused, index) => `${label} line ${index}.`).join('\n');

const replyFor = (user: string): string => {
    if (user.includes('edited question')) {
        return 'edited answer is ready';
    }
    if (user.includes('beta second')) {
        return lines('Second');
    }
    if (user.includes('alpha first')) {
        return lines('First');
    }
    return `Unexpected: ${user.slice(0, 120)}`;
};

const send = async (page: Page, text: string): Promise<void> => {
    await page.locator('#ingot-composer-input').fill(text);
    await page.locator('#ingot-composer-input').press('Enter');
};

const pinchThread = async (page: Page): Promise<void> => {
    await page.locator('.ingot-agents-chat-wrap').evaluate(el => {
        const node = el as HTMLElement;
        node.style.flex = 'none';
        node.style.height = '140px';
    });
    // The thread settles at the bottom of the smaller list before the reader scrolls up.
    await expect.poll(() => page.locator('.ingot-agents-chat').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(2);
    await page.locator('.ingot-agents-chat').evaluate(el => {
        el.scrollTop = 0;
        el.dispatchEvent(new Event('scroll'));
    });
};

test('composer chrome, latest turn, jump and edit', async ({ page }) => {
    test.setTimeout(120_000);
    await openIngot(page);
    await setAppearance(page, 'light');
    await dismissNotifications(page);
    const server = await startFakeOllama((_system, user) => replyFor(user), { delayMs: 0, chunkSize: 4_000 });
    try {
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');

        await expect(page.locator('#ingot-composer-zaprex')).toHaveCount(0);
        // Signed out: the Zaprex app entry is PRO+ only.
        await expect(page.locator('#ingot-tb-zaprex')).toHaveCount(0);
        await expect(page.locator('.ingot-composer-bar #ingot-composer-mode')).toHaveText(/Agent/);
        await expect(page.locator('.ingot-composer-bar #ingot-composer-review')).toHaveCount(0);

        await page.locator('#ingot-composer-more').click();
        await expect(page.locator('#ingot-composer-more-menu')).toBeVisible();
        await expect(page.locator('#ingot-composer-more-menu #ingot-composer-mode')).toHaveCount(0);
        await expect(page.locator('#ingot-composer-review')).toBeVisible();
        const surface = await tokenColor(page, '--ingot-surface');
        const card = await tokenColor(page, '--ingot-agent-card');
        await expect(page.locator('#ingot-composer-more-menu')).toHaveCSS('background-color', surface);
        await expect(page.locator('.ingot-agents .ingot-composer')).toHaveCSS('background-color', card);
        await saveShot(page, 'composer-overflow-light.png');
        await page.locator('#ingot-composer-more').click();

        await send(page, 'alpha first question');
        await expect(page.locator('.ingot-chat-agent .ingot-md').last()).toContainText('First line 0');
        await send(page, 'beta second question');
        await expect(page.locator('.ingot-chat-agent .ingot-md').last()).toContainText('Second line 0');
        await expect(page.locator('#ingot-composer-stop')).toHaveCount(0);

        const latest = page.locator('.ingot-chat-latest');
        await expect(latest).toContainText('beta second question');
        await expect(page.locator('.ingot-chat-user', { hasText: 'alpha first question' })).not.toHaveClass(/ingot-chat-latest/);
        // The latest prompt is the quiet prompt card: card fill and a 1px border, no accent bar.
        expect(await latest.evaluate(el => getComputedStyle(el).boxShadow)).toBe('none');
        await expect(latest).toHaveCSS('background-color', card);
        expect(await latest.evaluate(el => getComputedStyle(el).borderTopWidth)).toBe('1px');
        await saveShot(page, 'chat-latest-light.png');

        await expect(page.locator('#ingot-jump-latest')).toHaveCount(0);
        await expect(page.locator('#ingot-jump-earlier')).toBeVisible();
        await pinchThread(page);
        await expect(page.locator('#ingot-jump-latest')).toBeVisible();
        await saveShot(page, 'jump-to-latest-light.png');
        await page.locator('#ingot-jump-earlier').click();
        await page.locator('#ingot-jump-menu button', { hasText: 'alpha first' }).click();
        await expect(page.locator('.ingot-chat-user', { hasText: 'alpha first question' })).toBeInViewport();
        await page.locator('#ingot-jump-latest').click();
        await expect(page.locator('#ingot-jump-latest')).toHaveCount(0);
        // A smooth glide to the very bottom.
        await expect.poll(() => page.locator('.ingot-agents-chat').evaluate(el => el.scrollHeight - el.scrollTop - el.clientHeight)).toBeLessThanOrEqual(2);
        await page.locator('.ingot-agents-chat-wrap').evaluate(el => {
            const node = el as HTMLElement;
            node.style.flex = '';
            node.style.height = '';
        });
        await latest.evaluate(el => el.scrollIntoView({ block: 'center' }));
        await expect(latest).toBeInViewport();
        const first = page.locator('.ingot-chat-user', { hasText: 'alpha first question' });
        await first.locator('.ingot-chat-edit').click();
        await expect(page.locator('#ingot-chat-edit-input')).toHaveValue(/alpha first question/);
        await page.locator('#ingot-chat-edit-cancel').click();
        await expect(page.locator('.ingot-agents-chat')).toContainText('beta second question');

        await first.locator('.ingot-chat-edit').click();
        await page.locator('#ingot-chat-edit-input').fill('edited question about the picker');
        await saveShot(page, 'chat-edit-light.png');
        await page.locator('#ingot-chat-edit-submit').click();
        await page.locator('#ingot-chat-edit-revert').click();
        await expect(page.locator('.ingot-chat-agent .ingot-md').last()).toContainText('edited answer is ready');
        await expect(page.locator('.ingot-agents-chat')).toContainText('edited question about the picker');
        await expect(page.locator('.ingot-agents-chat')).not.toContainText('beta second question');
        await expect(page.locator('.ingot-agents-chat')).not.toContainText('alpha first question');
        await expect(page.locator('.ingot-chat-latest')).toContainText('edited question');

        await setAppearance(page, 'dark');
        await page.locator('#ingot-composer-input').fill('theme check');
        const darkSend = await tokenColor(page, '--ingot-agent-accent');
        const darkText = await tokenColor(page, '--ingot-agent-accent-text');
        const darkSurface = await tokenColor(page, '--ingot-surface');
        const darkCard = await tokenColor(page, '--ingot-agent-card');
        await expect(page.locator('#ingot-composer-send')).toHaveCSS('background-color', darkSend);
        await expect(page.locator('#ingot-composer-send')).toHaveCSS('color', darkText);
        expect(darkSend).not.toBe('rgb(217, 160, 78)');
        expect(darkSurface).not.toBe(surface);
        await page.locator('#ingot-composer-more').click();
        await expect(page.locator('#ingot-composer-more-menu')).toHaveCSS('background-color', darkSurface);
        await expect(page.locator('.ingot-agents .ingot-composer')).toHaveCSS('background-color', darkCard);
        await saveShot(page, 'composer-overflow-dark.png');
    } finally {
        await server.close();
    }
});
