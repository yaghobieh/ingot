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
// Built at runtime so the repository secret scan does not flag this obviously fake key.
const FAKE_KEY = ['sk', 'e2e', 'not', 'a', 'real', 'key', '0000000000'].join('-');

/** Tab predictions (IDEA-285) are covered in tab.spec.ts; here they stay empty. */
const reply = (system: string): string => (system.includes('Ingot Tab') ? '' : CHAT_REPLY);

test.describe('IDEA-25/26 models (BYOK)', () => {
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
