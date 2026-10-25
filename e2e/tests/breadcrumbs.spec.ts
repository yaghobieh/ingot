import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';

/** IDEA-76: breadcrumbs bar under the tabs, outline tree popup, folder popup and info hovers. */
const CART = `/** Shopping cart helpers. */
export class Cart {
    items: string[] = [];

    /** Adds an item to the cart. */
    add(item: string): void {
        [1, 2].forEach(n => {
            this.items.push(item + n);
        });
    }

    clear(): void {
        this.items = [];
    }
}

export function total(cart: Cart): number {
    return cart.items.length;
}
`;

const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });

const crumbs = (page: Page) => page.locator('.theia-breadcrumbs .theia-breadcrumb-item');
const crumb = (page: Page, label: string) => crumbs(page).filter({ has: page.locator('.ingot-bc-label', { hasText: new RegExp(`^\\s*${label.replace(/[()]/g, '\\$&')}\\s*$`) }) });

test.describe('IDEA-76 breadcrumbs', () => {
    let dir: string;
    test.beforeEach(() => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-crumbs-')));
        fs.mkdirSync(path.join(dir, 'src'));
        fs.writeFileSync(path.join(dir, 'src', 'cart.ts'), CART);
        fs.writeFileSync(path.join(dir, 'src', 'other.ts'), 'export const other = 1;\n');
        git(dir, 'init', '-q', '-b', 'main');
        git(dir, 'config', 'user.email', 'e2e@ingot.dev');
        git(dir, 'config', 'user.name', 'E2E Bot');
        git(dir, 'add', '.');
        git(dir, 'commit', '-q', '-m', 'Initial cart');
    });
    test.afterEach(() => fs.rmSync(dir, { recursive: true, force: true }));

    const openCart = async (page: Page): Promise<void> => {
        await openIngot(page, dir);
        await dismissNotifications(page);
        await page.locator('#explorer-view-container .theia-TreeNode', { hasText: 'src' }).first().click();
        await page.keyboard.press('ArrowRight');
        await page.locator('#explorer-view-container .theia-TreeNode', { hasText: 'cart.ts' }).first().dblclick();
        await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('export class Cart');
    };

    test('root › folder › file › symbol chain sits under the tabs and follows the caret', async ({ page }) => {
        await openCart(page);
        const bar = page.locator('.theia-breadcrumbs').first();
        await expect(bar).toBeVisible();
        const box = (await bar.boundingBox())!;
        const editor = (await page.locator('.monaco-editor').first().boundingBox())!;
        expect(box.y + box.height).toBeLessThanOrEqual(editor.y + 1);

        await page.locator('.view-line', { hasText: 'this.items.push' }).click();
        await expect(crumb(page, 'forEach() callback')).toBeVisible({ timeout: 30_000 });
        const labels = (await crumbs(page).locator('.ingot-bc-label').allInnerTexts()).map(t => t.trim());
        expect(labels.slice(0, 5)).toEqual([path.basename(dir), 'src', 'cart.ts', 'Cart', 'add']);
        await expect(crumbs(page).first().locator('.codicon-folder')).toBeVisible();
        await expect(crumb(page, 'cart.ts').locator('.file-icon')).toBeVisible();
        await expect(crumb(page, 'add').locator('[class*="codicon-symbol-"]')).toBeVisible();

        await page.locator('.view-line', { hasText: 'return cart.items.length' }).click();
        await expect(crumb(page, 'total')).toBeVisible();
        await expect(crumb(page, 'Cart')).toHaveCount(0);
    });

    test('symbol segment opens the outline tree: current highlighted, type to filter, Enter navigates', async ({ page }) => {
        await openCart(page);
        await page.locator('.view-line', { hasText: 'this.items.push' }).click();
        await expect(crumb(page, 'add')).toBeVisible({ timeout: 30_000 });
        await crumb(page, 'add').click();
        const popup = page.locator('.ingot-bc-outline');
        await expect(popup).toBeVisible();
        await expect(popup.locator('.ingot-bc-row.current')).toHaveText('add');
        const rows = popup.locator('.ingot-bc-row .ingot-bc-row-label');
        await expect(rows).toContainText(['Cart', 'items', 'add', 'clear', 'total']);
        await expect(popup.locator('.ingot-bc-row[data-id]', { hasText: 'add' }).locator('.codicon-symbol-method')).toBeVisible();
        // Collapse/expand with the twisty.
        await popup.locator('.ingot-bc-row', { hasText: 'Cart' }).first().locator('.ingot-bc-twisty').click();
        await expect(rows).toHaveText(['Cart', 'total']);
        await popup.locator('.ingot-bc-row', { hasText: 'Cart' }).first().locator('.ingot-bc-twisty').click();

        await page.keyboard.type('cle');
        await expect(rows).toHaveText(['Cart', 'clear']);
        await page.keyboard.press('ArrowDown');
        await page.keyboard.press('Enter');
        await expect(popup).toBeHidden();
        await expect(crumb(page, 'clear')).toBeVisible();
    });

    test('folder segment lists that folder; hovers show file and symbol info', async ({ page }) => {
        await openCart(page);
        await crumb(page, 'src').click();
        const list = page.locator('.theia-breadcrumbs-popup');
        await expect(list.locator('.theia-TreeNode', { hasText: 'other.ts' })).toBeVisible();
        await expect(list.locator('.theia-TreeNode', { hasText: 'cart.ts' })).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(list).toBeHidden();

        await crumb(page, 'cart.ts').hover();
        const hover = page.locator('.ingot-bc-hover');
        await expect(hover).toContainText(path.join(dir, 'src', 'cart.ts'), { timeout: 10_000 });
        await expect(hover).toContainText('Git: Unchanged');
        await expect(hover).toContainText('Initial cart');
        await expect(hover).toContainText(git(dir, 'log', '-1', '--format=%h %an').trim().split(' ').slice(1).join(' '));
        await expect(hover).toContainText(git(dir, 'rev-parse', '--short=8', 'HEAD').trim());

        await page.locator('.view-line', { hasText: 'this.items.push' }).click();
        await expect(crumb(page, 'add')).toBeVisible({ timeout: 30_000 });
        await page.mouse.move(0, 0);
        await crumb(page, 'add').hover();
        await expect(page.locator('.ingot-bc-hover-signature')).toHaveText('add(item: string): void');
        await expect(page.locator('.ingot-bc-hover-doc')).toHaveText('Adds an item to the cart.');
    });
});
