import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { setAppearance, SHOTS_DIR, toolBlock } from '../src/agent-tools.e2e-utils';

/**
 * The chat list never scrolls sideways: a run that reads and edits a deeply nested file, quotes long paths and a long
 * link, runs a command with a long path and wide output and streams a wide diff keeps every row inside the panel.
 * Long paths wrap or end in an ellipsis; wide code, output and diff lines scroll inside their own block.
 * Checked in light and dark with real (space-taking) scrollbars, while the run streams and after it.
 */
const STREAM = { chunkSize: 24, delayMs: 30 };
const STEP_TIMEOUT = 45_000;
const CHAT = '#ingot-agents .ingot-agents-chat';
const DEEP_DIR = 'packages/storefront-checkout-experience/src/features/shopping-cart/components/line-items/price-breakdown';
const DEEP_FILE = `${DEEP_DIR}/CartLineItemPriceBreakdownWithDiscountsAndTaxes.tsx`;
const CHECK_SCRIPT = 'scripts/check-line-totals-against-the-reference-prices.mjs';
const CHECK_COMMAND = `node ${CHECK_SCRIPT} ${DEEP_FILE}`;
const WIDE_LINE = `export const lineItemPriceBreakdownWithDiscountsAndTaxes = (unitPriceInCents: number, quantity: number, discountRateFromPromotion: number, regionalTaxRate: number): number => Math.round(unitPriceInCents * quantity * (1 - discountRateFromPromotion) * (1 + regionalTaxRate));\n`;
const LONG_LINK = 'https://github.com/storefront/checkout-experience/blob/main/packages/storefront-checkout-experience/src/features/shopping-cart/components/line-items/price-breakdown/CartLineItemPriceBreakdownWithDiscountsAndTaxes.tsx#L1-L4';
const PROMPT = `round the cart line totals in ${DEEP_FILE}, it fails at /Users/dev/storefront/${DEEP_FILE}:12:5`;
const SUMMARY_MARK = 'now rounds once per line';
const SUMMARY = [
    `The price breakdown ${SUMMARY_MARK}. I changed \`${DEEP_FILE}\` and checked ${DEEP_DIR}/index.ts as well (${LONG_LINK}).`,
    '',
    '```ts',
    WIDE_LINE.trimEnd(),
    '```',
    '',
    `| File | Change |`,
    `| --- | --- |`,
    `| \`${DEEP_FILE}\` | ${'rounded once per line item instead of once per cart, '.repeat(2).trim()} |`
].join('\n');

const tool = (name: string, args: Record<string, unknown>): string => toolBlock(name, args).replace('On it.\n\n', '');

/** Read and search, run the check script (approved by a click), then stream the wide edit and sum up. */
const replyFor = (user: string): string => {
    if (user.includes('Tool result (ingot/run)')) {
        return `Rounding once per line.\n\n<<<EDIT ${DEEP_FILE}\n${WIDE_LINE.repeat(4)}>>>END\n${SUMMARY}`;
    }
    if (user.includes('Tool result (ingot/read_file)')) {
        return `Running the line total check.\n\n${tool('run', { command: CHECK_COMMAND })}`;
    }
    return `Reading \`${DEEP_FILE}\` first.\n\n${tool('read_file', { path: DEEP_FILE })}${tool('read_file', { path: `${DEEP_DIR}/index.ts` })}`;
};

const makeProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-hscroll-')));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'storefront', private: true }, undefined, 2));
    fs.mkdirSync(path.join(dir, DEEP_DIR), { recursive: true });
    fs.writeFileSync(path.join(dir, DEEP_FILE), 'export const lineItemPriceBreakdownWithDiscountsAndTaxes = (): number => 0;\n');
    fs.writeFileSync(path.join(dir, DEEP_DIR, 'index.ts'), `export * from './CartLineItemPriceBreakdownWithDiscountsAndTaxes';\n`);
    fs.mkdirSync(path.join(dir, 'scripts'));
    fs.writeFileSync(path.join(dir, CHECK_SCRIPT), `console.log(${JSON.stringify(`FAIL ${DEEP_FILE} `)} + 'expected 1999 cents, received 1998.9999999999998 cents; '.repeat(4));\n`);
    return dir;
};

interface ChatWidth { readonly scrollWidth: number; readonly clientWidth: number; readonly overflowing: string[] }

/** The chat list's widths, plus every row that sticks out past its right edge (for the failure message). */
const chatWidth = (page: Page): Promise<ChatWidth> => page.evaluate(selector => {
    const chat = document.querySelector<HTMLElement>(selector);
    if (!chat) {
        return { scrollWidth: 0, clientWidth: 0, overflowing: ['no chat list'] };
    }
    const edge = chat.getBoundingClientRect().left + chat.clientLeft + chat.clientWidth;
    const clipped = (el: Element): boolean => {
        for (let p = el.parentElement; p && p !== chat; p = p.parentElement) {
            if (getComputedStyle(p).overflowX !== 'visible') {
                return true;
            }
        }
        return false;
    };
    // A box past the edge, or a box whose own text spills out of it (a long word or path that does not wrap).
    const overflowing = Array.from(chat.querySelectorAll<HTMLElement>('*'))
        .filter(el => !clipped(el) && (el.getBoundingClientRect().right > edge + 1
            || (getComputedStyle(el).overflowX === 'visible' && el.clientWidth > 0 && el.scrollWidth > el.clientWidth + 1)))
        .map(el => `${el.tagName.toLowerCase()}.${Array.from(el.classList).join('.')} right=${Math.round(el.getBoundingClientRect().right - edge)}px`
            + ` content=${el.scrollWidth}/${el.clientWidth}px "${(el.textContent ?? '').slice(0, 60)}"`);
    return { scrollWidth: chat.scrollWidth, clientWidth: chat.clientWidth, overflowing };
}, CHAT);

const expectNoSideScroll = async (page: Page, step: string): Promise<void> => {
    const width = await chatWidth(page);
    expect.soft(width.scrollWidth, `${step}\n${width.overflowing.join('\n')}`).toBeLessThanOrEqual(width.clientWidth);
};

const shot = async (page: Page, name: string): Promise<void> => {
    if (SHOTS_DIR) {
        fs.mkdirSync(SHOTS_DIR, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS_DIR, name), animations: 'disabled' });
    }
};

const openSettingsPage = async (page: Page, id: string): Promise<void> => {
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), page.locator('#ingot-settings'));
    await page.locator(`#ingot-settings-node-${id}`).click();
};

// Headless Chromium hides scrollbars; the desktop app's vertical scrollbar takes room, so keep it in the layout.
test.use({ launchOptions: { ignoreDefaultArgs: ['--hide-scrollbars'] } });

test.describe('Agent chat width', () => {
    test.setTimeout(240_000);
    const dirs: string[] = [];
    let server: FakeOllama;

    test.beforeEach(async () => {
        server = await startFakeOllama((_system, user) => replyFor(user), STREAM);
    });

    test.afterEach(async () => {
        await server.close();
        dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
    });

    test('never scrolls sideways with long paths and a wide diff, in light and dark', async ({ page }) => {
        dirs.push(makeProject());
        await openIngot(page, dirs[0]);
        await openSettingsPage(page, 'appearance');
        const appearance = await page.locator('#ingot-setting-ingot-appearance').inputValue();
        await page.locator('#ingot-settings-cancel').click();
        const composer = page.locator('#ingot-composer-input');
        const chat = page.locator(CHAT);
        try {
            await connectOllama(page, server);
            for (const theme of ['light', 'dark'] as const) {
                if (theme !== 'light') {
                    dirs.push(makeProject());
                    await openIngot(page, dirs[dirs.length - 1]);
                }
                await setAppearance(page, theme);
                await page.locator('#ingot-agents-new').click();
                await pickModel(page, 'ollama-local');
                await dismissNotifications(page);
                await composer.fill(PROMPT);
                await composer.press('Enter');

                const run = page.locator('#ingot-approval-run');
                await expect(run).toBeVisible({ timeout: STEP_TIMEOUT });
                await expectNoSideScroll(page, `${theme}: approval`);
                await run.click();

                // While the wide edit streams, its diff card is in the list.
                await expect(chat.locator('.ingot-change-block.status-streaming').first()).toBeVisible({ timeout: STEP_TIMEOUT });
                await expectNoSideScroll(page, `${theme}: streaming edit`);

                await expect(page.locator('#ingot-chat-working')).toHaveCount(0, { timeout: STEP_TIMEOUT });
                await expect(chat.locator('.ingot-chat-agent .ingot-md').last()).toContainText(SUMMARY_MARK);
                await expectNoSideScroll(page, `${theme}: after the run`);

                const explored = chat.locator('#ingot-chat-explored .ingot-chat-explored-head');
                if (await explored.count()) {
                    await explored.click();
                    await expectNoSideScroll(page, `${theme}: explored open`);
                }

                // Wide code scrolls inside its own block, not the list.
                const pre = chat.locator('.ingot-md pre').last();
                await expect(pre).toHaveCSS('overflow-x', 'auto');
                expect(await pre.evaluate(el => el.scrollWidth > el.clientWidth)).toBe(true);

                await expect(chat).toHaveCSS('overflow-x', 'hidden');

                await chat.evaluate(el => { el.scrollTop = 0; });
                await shot(page, `hscroll-top-${theme}.png`);
                await chat.evaluate(el => { el.scrollTop = el.scrollHeight; });
                await shot(page, `hscroll-${theme}.png`);
            }
        } finally {
            if (await page.locator('#ingot-settings').isVisible()) {
                await page.locator('#ingot-settings-cancel').click();
            }
            await openSettingsPage(page, 'appearance');
            await page.locator('#ingot-setting-ingot-appearance').selectOption(appearance);
            await page.locator('#ingot-settings-ok').click();
        }
    });
});
