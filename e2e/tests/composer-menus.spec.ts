import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { composerPlainText } from '../src/composer.e2e-utils';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { E2E_CONFIG_DIR } from '../src/e2e.consts';
import { startOpenPlanServer, type FakeIngotServer } from '../src/fake-ingot-server';

/** IDEA-187: `/` built-in commands, the `@` file picker, and dropping files anywhere on the chat panel. */
const SHOTS = process.env.INGOT_SCREENSHOT_DIR;

const makeProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-menus-')));
    fs.mkdirSync(path.join(dir, 'src', 'utils'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'package.json'), '{ "name": "menus-demo" }\n');
    fs.writeFileSync(path.join(dir, 'src', 'cart.ts'), 'export const total = 1;\n');
    fs.writeFileSync(path.join(dir, 'src', 'utils', 'money.ts'), 'export const cents = (n: number) => n * 100;\n');
    fs.mkdirSync(path.join(dir, 'node_modules', 'dep'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'node_modules', 'dep', 'cart.js'), '// dependency\n');
    return dir;
};

const composer = (page: Page) => page.locator('#ingot-composer-input');
const openAgents = async (page: Page): Promise<void> => {
    if (!await composer(page).isVisible()) {
        await page.locator('#ingot-rs-agents').click();
    }
    await expect(composer(page)).toBeVisible();
};
const setScheme = async (page: Page, scheme: 'light' | 'dark'): Promise<void> => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.locator('#ingot-rs-theme').click();
    await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'System' }).first().click();
    await expect(page.locator('body')).toHaveClass(new RegExp(`ingot-${scheme}`));
};
const shot = async (page: Page, name: string): Promise<void> => {
    if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.locator('#ingot-agents').screenshot({ path: path.join(SHOTS, name) });
    }
};

for (const scheme of ['light', 'dark'] as const) {
    test.describe(`IDEA-187 composer / and @ menus, drag and drop (${scheme})`, () => {
        test.setTimeout(120_000);
        let dir: string;
        // The agent chat is a paid feature; the fake account server opens the plan.
        let account: FakeIngotServer;
        test.beforeEach(async () => {
            account = await startOpenPlanServer();
            dir = makeProject();
        });
        test.afterEach(async () => {
            await account.close();
            fs.rmSync(path.join(E2E_CONFIG_DIR, 'remote-config.json'), { force: true });
            fs.rmSync(dir, { recursive: true, force: true });
        });

        test('/ lists built-in commands and runs them', async ({ page }) => {
            await openIngot(page, dir);
            await dismissNotifications(page);
            await setScheme(page, scheme);
            await openAgents(page);
            await composer(page).focus();
            await page.keyboard.type('/');
            const menu = page.locator('#ingot-slash-menu');
            await expect(menu).toBeVisible();
            for (const name of ['agent', 'ask', 'plan', 'new', 'compact', 'model']) {
                await expect(menu.locator(`#ingot-slash-builtin-${name}`)).toBeVisible();
            }
            await shot(page, `composer-slash-menu-${scheme}.png`);
            await page.keyboard.type('pl');
            await expect(menu.locator('.ingot-slash-item')).toHaveCount(1);
            await page.keyboard.press('Enter');
            await expect(page.locator('#ingot-composer-more')).toHaveAttribute('data-mode', 'plan');
            await expect(composer(page)).toHaveText('');
            await expect(menu).toHaveCount(0);

            await page.keyboard.type('/mod');
            await page.locator('#ingot-slash-builtin-model').click();
            await expect(page.locator('#ingot-composer-model[aria-expanded="true"]')).toBeVisible();
            await page.keyboard.press('Escape');
        });

        test('@ picks project files (skips node_modules) and inserts the path', async ({ page }) => {
            await openIngot(page, dir);
            await dismissNotifications(page);
            await setScheme(page, scheme);
            await openAgents(page);
            await composer(page).focus();
            await page.keyboard.type('explain @');
            const menu = page.locator('#ingot-mention-menu');
            await expect(menu).toBeVisible();
            await expect(menu.locator('.ingot-mention-item[data-path="package.json"]')).toBeVisible();
            await page.keyboard.type('cart');
            await expect(menu.locator('.ingot-mention-item')).toHaveCount(1);
            await expect(menu.locator('.ingot-mention-item').first()).toHaveAttribute('data-path', 'src/cart.ts');
            await shot(page, `composer-mention-menu-${scheme}.png`);
            await page.keyboard.press('Enter');
            await expect(menu).toHaveCount(0);
            expect(await composerPlainText(page)).toBe('explain @src/cart.ts');

            // Arrow keys move the selection; Esc closes the picker without inserting.
            await page.keyboard.type('and @mo');
            await expect(menu.locator('.ingot-mention-item.selected')).toHaveAttribute('data-path', 'src/utils/money.ts');
            await page.keyboard.press('Escape');
            await expect(menu).toHaveCount(0);
            expect(await composerPlainText(page)).toBe('explain @src/cart.ts and @mo');

            // A fully typed path: Enter sends instead of picking.
            await composer(page).fill('');
            await page.keyboard.type('look at @src/cart.ts');
            await page.keyboard.press('Enter');
            await expect(page.locator('#ingot-agents .ingot-chat-user').last()).toContainText('look at @src/cart.ts');
        });

        test('dropping tree files or OS files on the chat panel adds file chips', async ({ page }) => {
            await openIngot(page, dir);
            await dismissNotifications(page);
            await setScheme(page, scheme);
            await openAgents(page);
            const chips = page.locator('#ingot-composer-input .ingot-chip-code');

            // The same payload the project tree puts on a drag (theia-editor-dnd URIs) and an OS file drag (Files).
            const dropOn = (selector: string, payload: { uri?: string; file?: string }) => page.locator(selector).first().evaluate((el, p) => {
                const data = new DataTransfer();
                if (p.uri) {
                    data.setData('theia-editor-dnd', p.uri);
                }
                if (p.file) {
                    data.items.add(new File(['NOTES FROM DISK\n'], p.file, { type: 'text/plain' }));
                }
                const box = el.getBoundingClientRect();
                const at = { clientX: box.left + 20, clientY: box.top + 10 };
                const accepted: boolean[] = [];
                for (const type of ['dragenter', 'dragover', 'drop']) {
                    accepted.push(!el.dispatchEvent(new DragEvent(type, { dataTransfer: data, bubbles: true, cancelable: true, ...at })));
                }
                return accepted;
            }, payload);
            const uri = (name: string): string => `file://${path.join(dir, name)}`;

            // Project tree → the input itself (dragover must be accepted, or the OS shows "no drop").
            expect(await dropOn('#ingot-composer-input', { uri: uri('package.json') })).toEqual([true, true, true]);
            await expect(chips).toHaveCount(1);
            await expect(chips.first()).toContainText('package.json');

            // Project tree → the chat area above the input (used to do nothing).
            expect(await dropOn('#ingot-agents .ingot-agents-chat', { uri: uri('src/cart.ts') })).toEqual([true, true, true]);
            await expect(chips).toHaveCount(2);
            await expect(chips.nth(1)).toContainText('cart.ts');

            // A file from the OS (Finder / Explorer) dropped on the chat area.
            expect(await dropOn('#ingot-agents .ingot-agents-chat', { file: 'notes.txt' })).toEqual([true, true, true]);
            await expect(chips).toHaveCount(3);
            await expect(chips.nth(2)).toContainText('notes.txt');
            await expect(page.locator('#ingot-agents.ingot-drop-active')).toHaveCount(0);
            await shot(page, `composer-dropped-files-${scheme}.png`);
        });
    });
}
