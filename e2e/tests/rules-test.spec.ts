import * as fs from 'fs';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, runCommand } from '../src/app.utils';
import { startFakeOpenRouter, type FakeOpenRouter } from '../src/fake-openrouter';
import { modelsPanel } from '../src/models.e2e-utils';
import { SCHEMES, makeRulesProject, openRulesTab, openWithScheme, readIn, rulesShot } from '../src/rules.utils';

/** IDEA-320: Rules tab › Test runs .ingot/tests/*.yaml against the rules with a cheap model under a hard cost cap. */
const FILES = {
    '.ingot/rules/types.md': '---\ndescription: Where types go\nalwaysApply: true\n---\nTypes go in a `<name>.types.ts` file and are imported with `import type`.\n',
    '.ingot/rules/style.md': '---\nalwaysApply: true\n---\nUse named exports only.\n',
    '.ingot/tests/rules.yaml': `tests:
  - name: Types go in a types file
    prompt: Add a CartItem interface. Where does it go?
    assert:
      - contains: cart.types.ts
      - judge: The interface goes in a .types.ts file and is imported with import type
    mock: Put it in src/cart/cart.types.ts and import it with import type.
  - name: Named exports
    prompt: Export the Cart component.
    assert:
      - contains: export const Cart
      - not_contains: export default
    mock: export default function Cart() {}
`
};
const MODEL = 'google/gemini-2.5-flash-lite';
// Built at runtime so the repository secret scan does not flag this obviously fake key.
const FAKE_KEY = ['or', 'e2e', 'not', 'a', 'real', 'key', '0000000000'].join('-');

const dialog = (page: Page) => page.locator('#ingot-rules-test-dialog');
const result = (page: Page, name: string) => dialog(page).locator(`#ingot-rules-test-results li[data-test="${name}"]`);

const setOpenRouterKey = async (page: Page, key?: string): Promise<void> => {
    await runCommand(page, 'Ingot: Models');
    await expect(modelsPanel(page)).toBeVisible();
    if (key) {
        await modelsPanel(page).locator('#ingot-model-key-openrouter').fill(key);
        await modelsPanel(page).locator('#ingot-model-save-openrouter').click();
        await expect(modelsPanel(page).locator('#ingot-model-status-openrouter')).toHaveText('Key in keychain');
    } else if (await modelsPanel(page).locator('#ingot-model-remove-openrouter').isVisible()) {
        await modelsPanel(page).locator('#ingot-model-remove-openrouter').click();
        await expect(modelsPanel(page).locator('#ingot-model-status-openrouter')).toHaveText('No key');
    }
};

test.describe('IDEA-320 ingot rules test', () => {
    let base = '';
    test.afterEach(() => {
        if (base) {
            fs.rmSync(base, { recursive: true, force: true });
        }
    });

    for (const scheme of SCHEMES) {
        test(`Rules tab › Test runs the tests with the free mock model and shows the pass rate (${scheme})`, async ({ page }) => {
            const made = makeRulesProject(FILES);
            base = made.base;
            await openWithScheme(page, scheme, made.repo);
            await openRulesTab(page);
            await page.locator('#ingot-mcp-rules-test').click();

            await expect(dialog(page)).toBeVisible();
            await expect(dialog(page).locator('#ingot-rules-test-status')).toContainText('2 tests ready');
            await dialog(page).locator('#ingot-rules-test-model').selectOption('mock');
            await expect(dialog(page).locator('#ingot-rules-test-cap')).toBeDisabled();
            await dialog(page).locator('#ingot-rules-test-run').click();

            await expect(dialog(page).locator('#ingot-rules-test-rate')).toHaveText('50%');
            await expect(dialog(page).locator('#ingot-rules-test-status')).toContainText('1 of 2 runs failed');
            await expect(result(page, 'Types go in a types file')).toHaveAttribute('data-state', 'ok');
            await expect(result(page, 'Named exports')).toHaveAttribute('data-state', 'fail');
            await expect(result(page, 'Named exports')).toContainText('export default');
            await expect(dialog(page).locator('#ingot-rules-test-cost')).toContainText('mock · $0.0000');
            await rulesShot(page, `rules-test-${scheme}`);

            const saved = JSON.parse(readIn(made.repo, '.ingot/.state/rules-test-report.json'));
            expect(saved.passed).toBe(1);
            expect(saved.total).toBe(2);
        });
    }

    test.describe('with OpenRouter', () => {
        let server: FakeOpenRouter | undefined;
        test.afterEach(async ({ page }) => {
            await dialog(page).locator('.dialogControl button', { hasText: 'Close' }).click().catch(() => undefined);
            await setOpenRouterKey(page).catch(() => undefined);
            await server?.close();
            server = undefined;
        });

        test('calls the model with the keychain key and never crosses the cost cap', async ({ page }) => {
            server = await startFakeOpenRouter((system, user) => user.startsWith('Criterion:') ? 'PASS\nok'
                : system.includes('named exports') ? 'Put it in src/cart/cart.types.ts, import type it. export const Cart = () => null;' : 'Not sure.');
            const made = makeRulesProject(FILES);
            base = made.base;
            await openWithScheme(page, 'light', made.repo);
            await setOpenRouterKey(page);

            await runCommand(page, 'Test Rules');
            await dialog(page).locator('#ingot-rules-test-model').selectOption(MODEL);
            await expect(dialog(page).locator('#ingot-rules-test-status')).toContainText('No OpenRouter key');
            await expect(dialog(page).locator('#ingot-rules-test-run')).toBeDisabled();
            await dialog(page).locator('.dialogControl button', { hasText: 'Close' }).click();

            await setOpenRouterKey(page, FAKE_KEY);
            await dismissNotifications(page);
            await runCommand(page, 'Test Rules');
            await dialog(page).locator('#ingot-rules-test-model').selectOption(MODEL);
            await dialog(page).locator('#ingot-rules-test-run').click();
            await expect(dialog(page).locator('#ingot-rules-test-rate')).toHaveText('100%');
            await expect(dialog(page).locator('#ingot-rules-test-cost')).toContainText(`${MODEL} · $0.0001 of $0.0500`);
            expect(server.requests.length).toBe(3);
            expect(server.requests.every(r => r.authorization === `Bearer ${FAKE_KEY}` && r.model === MODEL)).toBe(true);
            expect(server.requests[0].system).toContain('import type');
            expect(await page.content()).not.toContain(FAKE_KEY);

            // A cap below one call's worst case: nothing is sent and the run says so.
            const before = server.requests.length;
            await dialog(page).locator('#ingot-rules-test-cap').fill('0.00001');
            await dialog(page).locator('#ingot-rules-test-run').click();
            await expect(dialog(page).locator('#ingot-rules-test-status')).toContainText('Cost cap reached: 2 runs not made');
            expect(server.requests.length).toBe(before);
            await rulesShot(page, 'rules-test-capped-light', dialog(page));
        });
    });
});
