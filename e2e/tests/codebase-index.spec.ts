import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { setAppearance, shot, toolBlock } from '../src/agent-tools.e2e-utils';

/** IDEA-260: the project is indexed under .ingot/index, the agent's codebase_search returns ranked snippets, edits re-index. */
const SEARCH_RESULT = 'Tool result (ingot/codebase_search)';
const MANIFEST = path.join('.ingot', 'index', 'manifest.json');

test.describe('IDEA-260 codebase index and codebase_search', () => {
    test.setTimeout(180_000);
    let dir: string;
    let server: FakeOllama;

    test.beforeEach(async () => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-index-e2e-')));
        const write = (rel: string, text: string): void => {
            fs.mkdirSync(path.dirname(path.join(dir, rel)), { recursive: true });
            fs.writeFileSync(path.join(dir, rel), text);
        };
        write('package.json', JSON.stringify({ name: 'index-shop', private: true }, undefined, 2));
        write('src/pricing.ts', 'export const roundPrice = (price: number): number => Math.round(price * 100) / 100;\n');
        write('src/auth.ts', 'export const login = async (user: string, password: string) => ({ user, ok: password.length > 0 });\n');
        write('src/cart.ts', 'export const addToCart = (cart: string[], item: string): string[] => [...cart, item];\n');
        server = await startFakeOllama((_system, user) => {
            if (user.startsWith(SEARCH_RESULT)) {
                return user.includes('src/shipping.ts') ? 'Shipping is computed in src/shipping.ts.' : user.includes('1. src/pricing.ts') ? 'Prices are rounded in src/pricing.ts.' : 'Not found.';
            }
            return user.includes('shipping')
                ? toolBlock('codebase_search', { query: 'how is the shipping cost computed from weight' })
                : toolBlock('codebase_search', { query: 'where are prices rounded' });
        }, { delayMs: 0 });
    });
    test.afterEach(async ({ page }) => {
        await setAppearance(page, 'light').catch(() => undefined);
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const ask = async (page: Page, text: string): Promise<void> => {
        await page.locator('#ingot-composer-input').fill(text);
        await page.locator('#ingot-composer-input').press('Enter');
    };
    const manifestMtime = (): number => fs.statSync(path.join(dir, MANIFEST)).mtimeMs;

    test('shows the index state, answers codebase_search with ranked snippets and re-indexes changed files', async ({ page }) => {
        await openIngot(page, dir);
        await dismissNotifications(page);
        const status = page.locator('#status-bar-ingot-index');
        await expect(status).toContainText('Index ready', { timeout: 30_000 });
        await expect(status).toHaveClass(/ingot-status-index-ready/);
        await expect.poll(() => fs.existsSync(path.join(dir, MANIFEST)), { timeout: 15_000 }).toBe(true);
        expect(fs.readFileSync(path.join(dir, '.ingot', 'index', '.gitignore'), 'utf8')).toBe('*\n');

        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await ask(page, 'where are prices rounded?');
        await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('Prices are rounded in src/pricing.ts.', { timeout: 30_000 });
        const result = server.requests.map(r => r.user).find(user => user.startsWith(SEARCH_RESULT)) ?? '';
        expect(result).toContain('for "where are prices rounded" (local index, 4 files');
        expect(result).toMatch(/1\. src\/pricing\.ts:1-\d+ \(score \d\.\d\d\)/);
        expect(result).toContain('roundPrice');
        await shot(page, 'idea-260-search-light.png');

        // A file added on disk is indexed by the watcher, then found by the next search.
        fs.writeFileSync(path.join(dir, 'src', 'shipping.ts'), 'export const shippingCost = (weightKg: number): number => weightKg * 4.5;\n');
        await expect.poll(() => fs.readFileSync(path.join(dir, MANIFEST), 'utf8').includes('src/shipping.ts'), { timeout: 15_000 }).toBe(true);
        await ask(page, 'how is shipping computed?');
        await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('Shipping is computed in src/shipping.ts.', { timeout: 30_000 });

        // Rebuild Codebase Index (Ingot keymap: Ctrl+Alt+Shift+I) rewrites the index from cached embeddings.
        const before = manifestMtime();
        await page.keyboard.press('Control+Alt+Shift+I');
        await expect.poll(manifestMtime, { timeout: 15_000 }).toBeGreaterThan(before);
        await expect(status).toContainText('Index ready');
        await status.hover();
        await expect(page.locator('.theia-hover')).toContainText('5 files, 5 chunks, local embeddings (last pass: 0 embedded, 5 reused from cache)');
        await shot(page, 'idea-260-status-light.png');
        await page.mouse.move(0, 0);

        await setAppearance(page, 'dark');
        await expect(status).toContainText('Index ready');
        await shot(page, 'idea-260-search-dark.png');
    });
});
