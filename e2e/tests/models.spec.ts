import * as fs from 'fs';
import * as path from 'path';
import { expect, test } from '@playwright/test';
import { dismissNotifications, openIngot, runCommand } from '../src/app.utils';
import { E2E_CONFIG_DIR, FIXTURE_WORKSPACE } from '../src/e2e.consts';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama, modelsPanel as models } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { restoreFromHead } from '../src/git-restore';

const MATH = path.join(FIXTURE_WORKSPACE, 'src', 'math.ts');
const CHAT_REPLY = 'Hello from your local model';
const COMPLETION = 'tract(a: number, b: number): number {';
// Built at runtime so the repository secret scan does not flag this obviously fake key.
const FAKE_KEY = ['sk', 'e2e', 'not', 'a', 'real', 'key', '0000000000'].join('-');

const reply = (system: string): string => (system.includes('code completion engine') ? COMPLETION : CHAT_REPLY);

test.describe('IDEA-25/26 models (BYOK) and inline completion', () => {
    let server: FakeOllama;

    test.beforeEach(async () => { server = await startFakeOllama(reply); });
    test.afterEach(async () => {
        await server.close();
        restoreFromHead(MATH);
    });

    test('connects a local model and an agent answers through it', async ({ page }) => {
        await openIngot(page);
        await connectOllama(page, server);
        expect(server.requests.at(-1)?.model).toBe('e2e-coder');

        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        // IDEA-104: the status bar names the active chat's model.
        await expect(page.locator('#theia-statusBar [id$="ingot-chat-model-status"]')).toContainText('Qwen2.5 Coder (local)');
        await page.locator('#ingot-composer-input').fill('Say hello');
        await page.locator('#ingot-composer-input').press('Enter');
        await expect(page.locator('#ingot-agents .ingot-chat-agent .ingot-md')).toHaveText(CHAT_REPLY);
        expect(server.requests.at(-1)?.user).toBe('Say hello');
    });

    test('shows ghost text, Ctrl+Right accepts a word and Tab accepts the rest', async ({ page }) => {
        await openIngot(page);
        await connectOllama(page, server);
        await models(page).locator('#ingot-autocomplete-model').selectOption('ollama-local');
        await expect(page.locator('#theia-statusBar [id$="ingot-autocomplete-status"]')).toHaveText(/\bAI\s*$/);

        await page.locator('#files').getByText('src', { exact: true }).click();
        await page.locator('#files').getByText('math.ts', { exact: true }).dblclick();
        const editor = page.locator('.monaco-editor[data-uri$="math.ts"], .monaco-editor').first();
        await editor.click();
        await page.keyboard.press('Control+End');
        await page.keyboard.press('Enter');
        await page.keyboard.type('export function sub');
        const ghost = page.locator('.ghost-text-decoration, .ghost-text').first();
        await expect(ghost).toBeVisible({ timeout: 15_000 });
        expect(server.requests.at(-1)?.system).toContain('code completion engine');

        await page.keyboard.press('Control+ArrowRight');
        await expect(page.locator('.view-lines')).toContainText('export function subtract');
        await page.keyboard.press('Tab');
        await expect(page.locator('.view-lines')).toContainText('export function subtract(a: number, b: number): number {');
    });

    test('stores an API key only in the local key file', async ({ page }) => {
        await openIngot(page);
        await runCommand(page, 'Ingot: Models');
        await expect(models(page)).toBeVisible();
        test.skip(await models(page).locator('#ingot-models-no-keychain').isVisible(), 'No OS keychain on this machine');
        await dismissNotifications(page);

        await models(page).locator('#ingot-model-key-openai').fill(FAKE_KEY);
        await models(page).locator('#ingot-model-save-openai').click();
        await expect(models(page).locator('#ingot-model-result-openai')).toHaveText("Key saved in Ingot's local key file.");
        await expect(models(page).locator('#ingot-model-status-openai')).toHaveText('Key saved');
        await expect(models(page).locator('#ingot-model-key-openai')).toHaveValue('');
        expect(await page.content()).not.toContain(FAKE_KEY);
        const configFiles = fs.readdirSync(E2E_CONFIG_DIR, { recursive: true }).map(f => path.join(E2E_CONFIG_DIR, String(f))).filter(f => fs.statSync(f).isFile());
        for (const file of configFiles) {
            expect(fs.readFileSync(file, 'utf8')).not.toContain(FAKE_KEY);
        }

        await models(page).locator('#ingot-model-remove-openai').click();
        await expect(models(page).locator('#ingot-model-status-openai')).toHaveText('No key');
    });
});
