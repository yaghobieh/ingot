import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { FIXTURES_DIR } from '../src/e2e.consts';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/** Reference-comparison screenshots (docs/design/ide-reference.png). Run with INGOT_SHOTS_DIR=<dir>. */
const SHOTS_DIR = process.env.INGOT_SHOTS_DIR;
const SHOP = path.join(FIXTURES_DIR, 'shop-frontend');
const USE_CART = path.join(SHOP, 'src', 'hooks', 'useCart.ts');

const OPTIMISTIC = `import { useCallback } from 'react';
import useSWR from 'swr';
import { api } from '@/lib/api';

export function useCart(userId: string) {
  const { data, mutate } = useSWR(\`/cart/\${userId}\`);

  const addItem = useCallback(async (id: string, qty = 1) => {
    const next = { items: [...(data?.items ?? []), { id, qty }] };
    await mutate(api.post('/cart', { id, qty }), {
      optimisticData: next, rollbackOnError: true,
    });
  }, [data, mutate]);

  return { items: data?.items ?? [], addItem };
}

// TODO(agent): add removeItem with the same rollback strategy`;

const REPLY = [
    'PLAN:',
    '- Read useCart.ts and api.ts',
    '- Add optimistic mutate with rollback',
    '- Update tests for qty',
    '',
    'Making addItem optimistic with qty support.',
    '<<<EDIT src/hooks/useCart.ts',
    OPTIMISTIC,
    '>>>END'
].join('\n');

const tree = (page: Page, name: string) => page.locator('#explorer-view-container .theia-TreeNode', { hasText: new RegExp(`^${name.replace('.', '\\.')}$`) }).first();

const openFile = async (page: Page, name: string): Promise<void> => {
    await tree(page, name).dblclick();
    await expect(page.locator('.lm-TabBar-tab', { hasText: name }).first()).toBeVisible();
};

test.describe('Reference look screenshots', () => {
    test.skip(!SHOTS_DIR, 'set INGOT_SHOTS_DIR to capture reference comparison screenshots');
    let server: FakeOllama;

    test.beforeEach(async () => { server = await startFakeOllama(() => REPLY); });
    test.afterEach(async () => {
        await server.close();
        execFileSync('git', ['checkout', '--', USE_CART], { cwd: SHOP });
    });

    for (const scheme of ['light', 'dark'] as const) {
        test(`main window with an agent edit (${scheme})`, async ({ page }) => {
            fs.mkdirSync(SHOTS_DIR!, { recursive: true });
            await page.emulateMedia({ colorScheme: scheme });
            await openIngot(page, SHOP);
            await page.locator('#ingot-tb-theme').click();
            await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'System' }).first().click();
            await expect(page.locator('body')).toHaveClass(new RegExp(`ingot-${scheme}`));
            await connectOllama(page, server);
            const modelsTab = page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: 'Models' }).first();
            if (await modelsTab.count()) {
                await modelsTab.click({ button: 'middle' });
            }
            for (const [folder, child] of [['src', 'hooks'], ['hooks', 'useCart.ts'], ['lib', 'api.ts']]) {
                await expect(async () => {
                    if (!(await tree(page, child).isVisible())) {
                        await tree(page, folder).click();
                    }
                    await expect(tree(page, child)).toBeVisible({ timeout: 1_500 });
                }).toPass({ timeout: 20_000 });
            }
            await openFile(page, 'api.ts');
            await openFile(page, 'useCart.ts');
            await page.locator('#ingot-agents-new').click();
            await page.locator('#ingot-composer-model').selectOption('ollama-local');
            await page.locator('#ingot-composer-input').fill('Make addItem optimistic and add qty support');
            await page.locator('#ingot-composer-input').press('Enter');
            await expect(page.locator('#ingot-agents-keep')).toBeEnabled({ timeout: 30_000 });
            await dismissNotifications(page);
            await page.waitForTimeout(800);
            await page.screenshot({ path: path.join(SHOTS_DIR!, `ingot-${scheme}.png`) });
            await page.locator('#ingot-agents-undo').click();
        });
    }
});
