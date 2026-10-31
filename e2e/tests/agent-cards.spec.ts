import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { makeToolsProject, setAppearance, SHOTS_DIR, tokenColor } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/**
 * In-chat cards share the agent card look of the reference mock: card background, 1px border all round (no colored
 * side bar), 8px radius, a 600 title row and 24px buttons with a 6px radius; the main action is the accent button.
 * Covers the approval card and the ask card in light and dark; INGOT_SHOTS=<dir> saves the panel.
 */
const SCHEMES = ['light', 'dark'] as const;
const CARD_RADIUS = '8px';
const BUTTON_RADIUS = '6px';
const BUTTON_HEIGHT = 24;
const BORDER = '1px';
const COMMAND = 'node -e "console.log(42)"';
const QUESTION = 'Which name should the banner use?';

const toolCall = (name: string, args: Record<string, unknown>): string =>
    `<tool_call>\n${JSON.stringify({ name: `ingot/${name}`, arguments: args })}\n</tool_call>`;

const css = (locator: Locator, prop: string): Promise<string> => locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

const panelShot = async (page: Page, name: string): Promise<void> => {
    if (SHOTS_DIR) {
        fs.mkdirSync(SHOTS_DIR, { recursive: true });
        await page.mouse.move(0, 0);
        await page.locator('.ingot-agents').screenshot({ path: path.join(SHOTS_DIR, name), animations: 'disabled' });
    }
};

/** One card: agent card background, even 1px border, 8px radius, no inset bar. */
const expectCard = async (page: Page, card: Locator): Promise<void> => {
    expect.soft(await css(card, 'border-top-left-radius')).toBe(CARD_RADIUS);
    expect.soft(await css(card, 'border-left-width')).toBe(BORDER);
    expect.soft(await css(card, 'border-left-color')).toBe(await css(card, 'border-top-color'));
    expect.soft(await css(card, 'box-shadow')).toBe('none');
    expect.soft(await css(card, 'background-color')).toBe(await tokenColor(page, '--ingot-agent-card'));
};

const expectButton = async (button: Locator): Promise<void> => {
    expect.soft(Math.round((await button.boundingBox())!.height)).toBe(BUTTON_HEIGHT);
    expect.soft(await css(button, 'border-top-left-radius')).toBe(BUTTON_RADIUS);
};

test.describe('agent chat cards', () => {
    test.setTimeout(240_000);
    let home: string;
    let server: FakeOllama;

    test.beforeEach(async () => {
        home = makeToolsProject('ingot-cards-');
        server = await startFakeOllama((_system, user) => {
            if (user.startsWith('Tool result (ingot/run)')) {
                return 'The check printed 42.';
            }
            if (user.includes('Name the banner')) {
                return toolCall('ask_user', { question: QUESTION });
            }
            if (user.includes('Ada Lovelace')) {
                return 'Using Ada Lovelace.';
            }
            return `Running the check.\n\n<<<TOOL ingot/run\n${JSON.stringify({ command: COMMAND })}\n>>>END`;
        }, { delayMs: 0 });
    });

    test.afterEach(async () => {
        await server.close();
        fs.rmSync(home, { recursive: true, force: true });
    });

    test('approval and ask cards share the agent card look in light and dark', async ({ page }) => {
        await openIngot(page, home);
        await dismissNotifications(page);
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        const composer = page.locator('#ingot-composer-input');

        for (const scheme of SCHEMES) {
            await setAppearance(page, scheme);
            await expect(page.locator('body')).toHaveClass(new RegExp(`ingot-${scheme}`));
            await dismissNotifications(page);

            // Approval card: Skip / Always Run / Run, Run is the accent button.
            await composer.fill(`run the check (${scheme})`);
            await composer.press('Enter');
            const approval = page.locator('#ingot-approval');
            await expect(page.locator('#ingot-approval-line')).toHaveText(`Run command: ${COMMAND}`, { timeout: 60_000 });
            await panelShot(page, `cards-approval-${scheme}.png`);
            await expectCard(page, approval);
            for (const id of ['#ingot-approval-skip', '#ingot-approval-always', '#ingot-approval-run']) {
                await expectButton(page.locator(id));
            }
            expect.soft(await css(page.locator('#ingot-approval-run'), 'background-color')).toBe(await tokenColor(page, '--ingot-agent-accent'));
            const wrap = await page.locator('#ingot-approval-wrap').boundingBox();
            const stack = await page.locator('.ingot-agents .ingot-composer').boundingBox();
            expect.soft(Math.round(wrap!.x)).toBe(Math.round(stack!.x));
            await page.locator('#ingot-approval-run').click();
            await expect(page.locator('.ingot-chat-agent .ingot-md').last()).toContainText('The check printed 42.', { timeout: 60_000 });

            // Ask card in the thread: the same card, no accent side bar; Send is the accent button.
            await composer.fill(`Name the banner (${scheme})`);
            await composer.press('Enter');
            const ask = page.locator('.ingot-agents-chat #ingot-ask');
            await expect(ask.locator('#ingot-ask-question')).toHaveText(QUESTION, { timeout: 60_000 });
            await ask.locator('#ingot-ask-input').fill('Ada Lovelace');
            await panelShot(page, `cards-ask-${scheme}.png`);
            await expectCard(page, ask);
            await expectButton(ask.locator('#ingot-ask-submit'));
            expect.soft(await css(ask.locator('#ingot-ask-submit'), 'background-color')).toBe(await tokenColor(page, '--ingot-agent-accent'));
            await ask.locator('#ingot-ask-submit').click();
            await expect(page.locator('#ingot-ask')).toHaveCount(0);
            await expect(page.locator('.ingot-chat-agent .ingot-md').last()).toContainText('Using Ada Lovelace.', { timeout: 60_000 });
        }
    });
});
