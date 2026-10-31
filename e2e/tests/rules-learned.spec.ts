import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { runCommand } from '../src/app.utils';
import { pickModel } from '../src/chat.e2e-utils';
import { E2E_CONFIG_DIR } from '../src/e2e.consts';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { SCHEMES, existsIn, makeRulesProject, openRulesTab, openWithScheme, readIn, rulesShot } from '../src/rules.utils';

/** IDEA-328: opt-in learned rules. A rejected hunk or a repeated correction becomes a rule proposal, reviewed as a diff. */
const PREF = 'ingot.rules.learnFromReviews';
const CART = 'export const total = (items: number[]): number => items.reduce((a, b) => a + b, 0);\n';
const EDIT_REPLY = [
    'Adding a debug helper.',
    '<<<EDIT src/cart.ts',
    `${CART}\nexport const debugTotal = (items: number[]): number => {\n    console.log(items);\n    return total(items);\n};`,
    '>>>END',
    'Done.'
].join('\n');
const CORRECTION = 'No, use pnpm instead of npm.';
const CORRECTION_AGAIN = 'Again: use pnpm instead of npm';

const dialog = (page: Page) => page.locator('#ingot-learned-dialog');
const toast = (page: Page) => page.locator('.theia-notification-list-item').filter({ hasText: 'drafted a rule' }).first();

const say = async (page: Page, text: string, newChat = false, waitIdle = true): Promise<void> => {
    if (newChat) {
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
    }
    await page.locator('#ingot-composer-input').fill(text);
    await page.locator('#ingot-composer-input').press('Enter');
    await expect(page.locator('#ingot-agents .ingot-chat-user').last()).toContainText(text, { timeout: 30_000 });
    if (waitIdle) {
        await expect(page.locator('#ingot-composer-stop')).toHaveCount(0, { timeout: 30_000 });
    }
};

/** Puts the opt-in back to off in the e2e user settings (Theia reloads the file). */
const resetPreference = (): void => {
    const file = path.join(E2E_CONFIG_DIR, 'settings.json');
    const settings = JSON.parse(fs.readFileSync(file, 'utf8')) as Record<string, unknown>;
    fs.writeFileSync(file, JSON.stringify({ ...settings, [PREF]: false }, undefined, 4));
};

test.describe('IDEA-328 learned rules from reviews', () => {
    let base = '';
    let server: FakeOllama | undefined;
    test.afterEach(async () => {
        resetPreference();
        await server?.close();
        server = undefined;
        if (base) {
            fs.rmSync(base, { recursive: true, force: true });
        }
    });

    for (const scheme of SCHEMES) {
        test(`rejecting a hunk with console.log proposes a rule; Add Rule writes the reviewed text (${scheme})`, async ({ page }) => {
            server = await startFakeOllama(() => EDIT_REPLY);
            const made = makeRulesProject({ 'src/cart.ts': CART });
            base = made.base;
            await openWithScheme(page, scheme, made.repo);

            // Off by default: the Rules tab's Learned button offers to turn it on.
            await openRulesTab(page);
            await page.locator('#ingot-mcp-rules-learned').click();
            await page.locator('.theia-notification-list-item').filter({ hasText: 'Learn rules from reviews is off' }).first().getByRole('button', { name: 'Turn On' }).click();
            await expect.poll(() => JSON.parse(fs.readFileSync(path.join(E2E_CONFIG_DIR, 'settings.json'), 'utf8'))[PREF]).toBe(true);

            await connectOllama(page, server);
            await say(page, 'Add a debug helper to src/cart.ts', true, false);
            const reject = page.locator('.ingot-hunk-reject').first();
            await expect(reject).toBeVisible({ timeout: 20_000 });
            await reject.click();
            await expect.poll(() => readIn(made.repo, 'src/cart.ts')).toBe(CART);

            await expect(toast(page)).toContainText('No console.log in code', { timeout: 15_000 });
            await toast(page).getByRole('button', { name: 'Review' }).click();
            await expect(dialog(page)).toBeVisible();
            await expect(dialog(page).locator('#ingot-learned-head')).toHaveAttribute('data-source', 'rejection');
            await expect(dialog(page).locator('#ingot-learned-evidence')).toContainText('src/cart.ts: console.log(items);');
            await expect(dialog(page).locator('#ingot-learned-path')).toHaveText('.ingot/rules/learned-no-console-log-in-code.md');
            await expect(dialog(page).locator('#ingot-learned-diff')).toContainText('+ globs: **/*.ts');
            await dialog(page).locator('#ingot-learned-body').fill('Don\'t leave console.log calls. Use the logger in src/log.ts.');
            await expect(dialog(page).locator('#ingot-learned-diff')).toContainText('+ Don\'t leave console.log calls. Use the logger in src/log.ts.');
            await rulesShot(page, `learned-rules-${scheme}`);

            await dialog(page).locator('#ingot-learned-accept').click();
            await expect(dialog(page).locator('#ingot-learned-notice')).toContainText('Added .ingot/rules/learned-no-console-log-in-code.md');
            expect(readIn(made.repo, '.ingot/rules/learned-no-console-log-in-code.md'))
                .toBe('---\ndescription: No console.log in code\nglobs: **/*.ts\nlearned: rejection\n---\nDon\'t leave console.log calls. Use the logger in src/log.ts.\n');
            await expect(dialog(page).locator('#ingot-learned-empty')).toBeVisible();
        });
    }

    test('off by default; once on, a correction made twice is proposed, and Dismiss keeps it out of .ingot/rules', async ({ page }) => {
        server = await startFakeOllama(() => 'OK.');
        const made = makeRulesProject({ 'package.json': '{"name":"shop"}\n' });
        base = made.base;
        await openWithScheme(page, 'light', made.repo);
        await connectOllama(page, server);

        await say(page, CORRECTION, true);
        await say(page, CORRECTION_AGAIN);
        expect(existsIn(made.repo, '.ingot/.state/learned-rules.json')).toBe(false);

        await runCommand(page, 'Learn Rules from Reviews');
        await expect.poll(() => JSON.parse(fs.readFileSync(path.join(E2E_CONFIG_DIR, 'settings.json'), 'utf8'))[PREF]).toBe(true);
        await say(page, CORRECTION);
        await expect(toast(page)).toHaveCount(0);
        await say(page, CORRECTION_AGAIN);
        await expect(toast(page)).toContainText('Use pnpm instead of npm', { timeout: 15_000 });
        await toast(page).getByRole('button', { name: 'Review' }).click();

        await expect(dialog(page).locator('#ingot-learned-head')).toHaveAttribute('data-source', 'correction');
        await expect(dialog(page).locator('#ingot-learned-evidence li')).toHaveCount(2);
        await expect(dialog(page).locator('#ingot-learned-diff')).toContainText('+ alwaysApply: true');
        await rulesShot(page, 'learned-rules-correction-light', dialog(page));
        await dialog(page).locator('#ingot-learned-dismiss').click();
        await expect(dialog(page).locator('#ingot-learned-notice')).toContainText('won\'t suggest');

        const state = JSON.parse(readIn(made.repo, '.ingot/.state/learned-rules.json'));
        expect(state.proposals[0].status).toBe('dismissed');
        expect(fs.readdirSync(path.join(made.repo, '.ingot')).includes('rules')).toBe(false);
        await dialog(page).locator('.dialogControl button', { hasText: 'Close' }).click();
        await expect(dialog(page)).toHaveCount(0);
        await say(page, CORRECTION);
        await expect(toast(page)).toHaveCount(0);
    });
});
