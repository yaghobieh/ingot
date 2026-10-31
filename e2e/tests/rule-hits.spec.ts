import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { RULES_MONOREPO } from '../src/rules-insight.e2e-consts';
import { openFile, shootLightAndDark } from '../src/rules-insight.e2e-utils';

const panel = (page: Page) => page.locator('#ingot-rule-hits');
const hit = (page: Page, name: string) => panel(page).locator('.ingot-rh-turn.latest .ingot-rh-hit').filter({ has: page.locator('.ingot-tw-name', { hasText: new RegExp(`^${name.replace('.', '\\.')}$`) }) });

test.describe('IDEA-318 Rule Hits panel with provenance', () => {
    let server: FakeOllama;

    test.beforeEach(async () => {
        server = await startFakeOllama(() => 'The App component is tidy now.');
    });
    test.afterEach(async () => { await server.close(); });

    test('shows which rules and AGENTS.md files a turn loaded, why, their cost and where they came from', async ({ page }) => {
        await openIngot(page, RULES_MONOREPO);
        await connectOllama(page, server);
        await openFile(page, 'packages/web/src/App.tsx', 'export const App');
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await dismissNotifications(page);
        await page.locator('#ingot-composer-input').focus();
        await page.keyboard.type('Tidy up the App component');
        await page.keyboard.press('Enter');
        await expect(page.locator('#ingot-agents .ingot-chat-agent .ingot-md').last()).toHaveText('The App component is tidy now.');
        expect(server.requests.at(-1)!.system).toContain('MONO-ROOT-AGENTS');

        // From the chat's "Read rules" step to the panel.
        const read = page.locator('#ingot-agents .ingot-chat-read').filter({ hasText: 'Read rules' }).last();
        await read.locator('.ingot-chat-read-label').click();
        await read.getByRole('button', { name: 'Why these rules?' }).click();
        await expect(panel(page)).toBeVisible();
        await expect(panel(page).locator('.ingot-rh-turn.latest .ingot-rh-prompt')).toHaveText('Tidy up the App component');
        await expect(hit(page, 'AGENTS.md').locator('.ingot-rh-reason')).toHaveText('AGENTS.md');
        await expect(hit(page, 'style').locator('.ingot-rh-reason')).toHaveText('always');
        await expect(hit(page, 'react').locator('.ingot-rh-reason')).toHaveText('glob');
        await expect(hit(page, 'react').locator('.ingot-tw-detail')).toContainText('packages/web/src/App.tsx');
        await expect(hit(page, 'legacy')).toHaveCount(0);
        await expect(panel(page).locator('.ingot-rh-turn.latest .ingot-rh-turn-head .ingot-rh-tokens')).toHaveText(/~\d+ tokens/);

        // Provenance: git author and date, commit, and the store pack.
        await hit(page, 'react').locator('.ingot-rh-row').click();
        const card = hit(page, 'react').locator('.ingot-rh-card');
        await expect(card).toContainText('.ingot/rules/react.md');
        await expect(card.locator('.ingot-rh-pack')).toHaveText('acme.react-pack@1.2.0');
        await expect(card.locator('.ingot-rh-author')).toHaveText(/\S+ · \d/);
        await hit(page, 'style').locator('.ingot-rh-row').click();
        await expect(hit(page, 'style').locator('.ingot-rh-pack')).toHaveText('Not from a store pack');
        await hit(page, 'react').locator('.ingot-rh-row').click();
        await shootLightAndDark(page, 'rule-hits');

        // The rule opens from its card.
        await hit(page, 'react').locator('.ingot-rh-card').getByRole('button', { name: '.ingot/rules/react.md' }).click();
        await expect(page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: 'react.md' })).toBeVisible();
    });

    test('opens from Find Action and its shortcut', async ({ page }) => {
        await openIngot(page, RULES_MONOREPO);
        await dismissNotifications(page);
        await page.locator('#files').click();
        await page.keyboard.press('Control+Alt+Shift+R');
        await expect(panel(page)).toBeVisible();
        await expect(panel(page)).toContainText('Send a message in Agents to see which rules');
    });
});
