import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { setAppearance, SHOTS_DIR } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/** IDEA-280: mode pill, mic beside send, reply reactions, typing \ | ` ~, queued steers + in-chat question, edit and rerun. */

const CDP_ALT = 1;
const CDP_CTRL = 2;

const composer = (page: Page) => page.locator('#ingot-composer-input');

const panelShot = async (page: Page, name: string): Promise<void> => {
    if (SHOTS_DIR) {
        fs.mkdirSync(SHOTS_DIR, { recursive: true });
        await page.locator('.ingot-agents').screenshot({ path: path.join(SHOTS_DIR, name), animations: 'disabled' });
    }
};

/** Light then dark picture of the panel; leaves the app in light. */
const bothThemes = async (page: Page, name: string): Promise<void> => {
    await panelShot(page, `${name}-light.png`);
    await setAppearance(page, 'dark');
    await expect(page.locator('body')).toHaveClass(/ingot-dark/);
    await panelShot(page, `${name}-dark.png`);
    await setAppearance(page, 'light');
    await expect(page.locator('body')).toHaveClass(/ingot-light/);
};

const send = async (page: Page, text: string): Promise<void> => {
    await composer(page).fill(text);
    await page.locator('#ingot-composer-send').click();
};

const start = async (page: Page, server: FakeOllama): Promise<void> => {
    await openIngot(page);
    await dismissNotifications(page);
    await connectOllama(page, server);
    await page.locator('#ingot-agents-new').click();
    await pickModel(page, 'ollama-local');
    await setAppearance(page, 'light');
};

const toolCall = (name: string, args: Record<string, unknown>): string =>
    `<tool_call>\n${JSON.stringify({ name: `ingot/${name}`, arguments: args })}\n</tool_call>`;

test.describe('IDEA-280 composer and chat usability', () => {
    test('mode pill and mic sit in the composer row; reactions are icon-only under replies; \\ | ` ~ type', async ({ page }) => {
        test.setTimeout(240_000);
        const server = await startFakeOllama(() => 'Here is the answer.', { delayMs: 0, chunkSize: 8_000 });
        try {
            await start(page, server);
            const bar = page.locator('.ingot-composer-bar');
            const pill = bar.locator('#ingot-composer-mode');
            await expect(pill).toBeVisible();
            await expect(pill).toHaveAttribute('data-mode', 'agent');
            await expect(pill.locator('.ingot-pill-label')).toBeVisible();
            await pill.click();
            await page.locator('#ingot-mode-plan').click();
            await expect(pill).toHaveAttribute('data-mode', 'plan');
            await expect(pill).toContainText('Plan');
            await composer(page).click();
            await page.keyboard.press('Control+.');
            await expect(pill).toHaveAttribute('data-mode', 'debug');
            await pill.click();
            await page.locator('#ingot-mode-agent').click();
            await expect(pill).toHaveAttribute('data-mode', 'agent');

            const mic = bar.locator('#ingot-composer-mic');
            await expect(mic).toBeVisible();
            await expect(page.locator('#ingot-composer-more-menu')).toHaveCount(0);
            const micBox = (await mic.boundingBox())!;
            const sendBox = (await page.locator('#ingot-composer-send').boundingBox())!;
            expect(micBox.x).toBeLessThan(sendBox.x);
            expect(Math.abs(micBox.y + micBox.height / 2 - (sendBox.y + sendBox.height / 2))).toBeLessThan(4);

            // Plain and shifted keys, then AltGr characters (reported as Ctrl+Alt): Polish AltGr+N types ń, which is also
            // the New Chat shortcut (Ctrl+Alt+N) in this keymap; Croatian AltGr+Q / AltGr+W type \ and |.
            const tabs = await page.locator('#ingot-chat-tabs [role="tab"]').count();
            await composer(page).click();
            await page.keyboard.type('a\\b|c`d~e ');
            const cdp = await page.context().newCDPSession(page);
            for (const [key, code, vk] of [['ń', 'KeyN', 78], ['\\', 'KeyQ', 81], ['|', 'KeyW', 87]] as const) {
                await cdp.send('Input.dispatchKeyEvent', { type: 'keyDown', modifiers: CDP_CTRL | CDP_ALT, key, code, text: key, unmodifiedText: key, windowsVirtualKeyCode: vk });
                await cdp.send('Input.dispatchKeyEvent', { type: 'keyUp', modifiers: CDP_CTRL | CDP_ALT, key, code, windowsVirtualKeyCode: vk });
            }
            await expect(composer(page)).toHaveText('a\\b|c`d~e ń\\|');
            await expect(page.locator('#ingot-chat-tabs [role="tab"]')).toHaveCount(tabs);
            await bothThemes(page, 'composer-row');

            await page.locator('#ingot-composer-send').click();
            await expect(page.locator('.ingot-chat-agent .ingot-md').last()).toContainText('Here is the answer.');
            expect(server.requests.at(-1)?.user).toContain('a\\b|c`d~e ń\\|');
            await expect(page.locator('.ingot-chat-user .ingot-reactions')).toHaveCount(0);
            const like = page.locator('.ingot-chat-agent #ingot-react-like-1');
            await expect(like).toHaveText('');
            await composer(page).hover();
            const reactions = page.locator('.ingot-chat-agent .ingot-reply-reactions');
            expect(Number(await reactions.evaluate(el => getComputedStyle(el).opacity))).toBeLessThan(1);
            await page.locator('.ingot-chat-agent').last().hover();
            await expect.poll(() => reactions.evaluate(el => getComputedStyle(el).opacity)).toBe('1');
            await like.click();
            await expect(like).toHaveAttribute('aria-pressed', 'true');
            await bothThemes(page, 'reply-reactions');
            await like.click();
            await expect(like).toHaveAttribute('aria-pressed', 'false');
        } finally {
            await server.close();
        }
    });

    test('messages sent mid-run are queued, and an in-chat question card resumes the run', async ({ page }) => {
        test.setTimeout(240_000);
        const server = await startFakeOllama((_system, user) => {
            if (user.includes('also mention tests')) {
                return 'Noted the tests.';
            }
            if (user.includes('Ada Lovelace')) {
                return 'Using Ada Lovelace.';
            }
            if (user.includes('Name the banner')) {
                return toolCall('ask_user', { question: 'Which name should the banner use?' });
            }
            return 'Still writing the note. '.repeat(90);
        }, { delayMs: 30, chunkSize: 12 });
        try {
            await start(page, server);
            await send(page, 'Write a long note');
            await expect(page.locator('#ingot-composer-stop')).toBeVisible();
            await send(page, 'also mention tests');
            const steer = page.locator('.ingot-chat-user', { hasText: 'also mention tests' });
            await expect(steer.locator('.ingot-queued-chip')).toHaveText('Queued');
            await expect(page.locator('#ingot-composer-stop')).toBeVisible();
            await bothThemes(page, 'queued-steer');
            await expect(page.locator('.ingot-chat-agent .ingot-md').last()).toContainText('Noted the tests.', { timeout: 60_000 });
            await expect(steer.locator('.ingot-queued-chip')).toHaveCount(0);
            expect(server.requests.filter(r => r.users.some(text => text.includes('also mention tests')))).toHaveLength(1);

            await send(page, 'Name the banner');
            const card = page.locator('.ingot-agents-chat #ingot-ask');
            await expect(card).toBeVisible();
            await expect(card.locator('#ingot-ask-question')).toHaveText('Which name should the banner use?');
            await expect(page.locator('#ingot-chat-tabs [data-run="waiting"]')).toHaveCount(1);
            const chat = page.locator('.ingot-agents-chat');
            expect(await chat.evaluate(el => el.scrollWidth - el.clientWidth)).toBeLessThanOrEqual(1);
            const cardBox = (await card.boundingBox())!;
            const inputBox = (await card.locator('#ingot-ask-input').boundingBox())!;
            expect(inputBox.y).toBeGreaterThan(cardBox.y);
            expect(inputBox.x + inputBox.width).toBeLessThanOrEqual(cardBox.x + cardBox.width);
            await card.locator('#ingot-ask-input').fill('Ada Lovelace');
            await bothThemes(page, 'ask-card');
            await card.locator('#ingot-ask-submit').click();
            await expect(page.locator('#ingot-ask')).toHaveCount(0);
            await expect(page.locator('.ingot-chat-agent .ingot-md').last()).toContainText('Using Ada Lovelace.');
        } finally {
            await server.close();
        }
    });

    test('clicking a sent prompt edits it; Send offers revert, keep, or cancel', async ({ page }) => {
        test.setTimeout(240_000);
        const server = await startFakeOllama((_system, user) => user.includes('second take') ? 'Second take answer.' : 'First answer.', { delayMs: 0, chunkSize: 8_000 });
        try {
            await start(page, server);
            await send(page, 'first take on the picker');
            await expect(page.locator('.ingot-chat-agent .ingot-md').last()).toContainText('First answer.');
            await page.locator('#ingot-msg-0').click({ position: { x: 60, y: 14 } });
            const input = page.locator('#ingot-chat-edit-input');
            await expect(input).toHaveValue('first take on the picker');
            await input.fill('second take on the picker');
            await page.locator('#ingot-chat-edit-submit').click();
            const choices = page.locator('#ingot-chat-edit-choices button');
            await expect(choices).toHaveText(['Revert changes after this point and rerun', 'Keep changes and rerun', 'Cancel']);
            await bothThemes(page, 'edit-choices');
            await page.locator('#ingot-chat-edit-cancel').click();
            await expect(page.locator('#ingot-chat-edit-choices')).toHaveCount(0);
            await expect(input).toHaveValue('second take on the picker');
            await page.locator('#ingot-chat-edit-submit').click();
            await page.locator('#ingot-chat-edit-keep').click();
            await expect(page.locator('.ingot-chat-agent .ingot-md').last()).toContainText('Second take answer.');
            await expect(page.locator('.ingot-agents-chat')).not.toContainText('first take on the picker');
            await expect(page.locator('.ingot-agents-chat')).not.toContainText('First answer.');
            expect(server.requests.at(-1)?.users).toEqual(['second take on the picker']);
        } finally {
            await server.close();
        }
    });
});
