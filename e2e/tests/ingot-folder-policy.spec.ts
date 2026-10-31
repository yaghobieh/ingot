import { expect, test, type Page } from '@playwright/test';
import { toolBlock } from '../src/agent-tools.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { answer, ask, auditLines, makeProject, openFile, openView, openWithScheme, removeProject, saveShot, SCHEMES } from '../src/ingot-dot.e2e-utils';
import { connectOllama } from '../src/models.e2e-utils';
import { runCommand } from '../src/app.utils';
import { pickModel } from '../src/chat.e2e-utils';

/** IDEA-326: the nearest .ingot/policy.yaml sets the model, the max cost per run and the auto-approve level for a folder. */
const API_POLICY = `model: ollama-local
budget:
  maxCostPerRun: 5
autoApprove: commands
`;
// $1 per input token: any model call goes over the cap, so the run stops before calling the model.
const LEGACY_POLICY = `budget:
  maxCostPerRun: 0.01
  price:
    input: 1000000
    output: 1000000
`;
const FILES = {
    '.ingot/policy.yaml': 'autoApprove: none\n',
    'apps/api/.ingot/policy.yaml': API_POLICY,
    'apps/api/src/server.ts': 'export const port = 8080;\n',
    'apps/legacy/.ingot/policy.yaml': LEGACY_POLICY,
    'apps/legacy/old.ts': 'export const old = true;\n',
    'package.json': '{"name":"mono","private":true}\n'
};

const status = (page: Page) => page.locator('#status-bar-ingot-policy-status');

/** Auto, so the run starts on another model than the one the policy names. */
const pickAuto = async (page: Page): Promise<void> => {
    await page.locator('#ingot-composer-model').click();
    await page.locator('#ingot-model-picker #ingot-pick-auto').click();
    await expect(page.locator('#ingot-model-picker')).toBeHidden();
};

test.describe('IDEA-326 per-folder model and budget policy', () => {
    test.setTimeout(150_000);
    let dir = '';
    let server: FakeOllama | undefined;
    test.afterEach(async () => {
        await server?.close();
        server = undefined;
        removeProject(dir);
    });

    for (const scheme of SCHEMES) {
        test(`the nearest policy picks the model and auto-approves commands; the status bar shows it (${scheme})`, async ({ page }) => {
            dir = makeProject('ingot-folder-policy-', FILES);
            server = await startFakeOllama((_system, user) => {
                if (user.startsWith('Tool result (ingot/run)')) {
                    return user.includes('42') ? 'The answer is 42.' : 'The command failed.';
                }
                return toolBlock('run', { command: 'node -e "console.log(6 * 7)"' });
            }, { delayMs: 0 });
            await openWithScheme(page, scheme, dir);
            await connectOllama(page, server);
            await openFile(page, 'apps/api/src/server.ts');
            await expect(status(page)).toContainText('Policy · ollama-local · ≤ $5.00 · auto: commands');

            await page.locator('#ingot-agents-new').click();
            await pickAuto(page);
            await ask(page, 'what is six times seven?');
            await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('The answer is 42.', { timeout: 60_000 });
            await expect(page.locator('#ingot-agents .ingot-chat-system').filter({ hasText: 'Model set by apps/api/.ingot/policy.yaml' })).toBeVisible();
            expect(server.requests.length).toBeGreaterThanOrEqual(2);
            // autoApprove: commands ran the command without the approval card.
            await expect(page.locator('#ingot-approval')).toHaveCount(0);

            const view = page.locator('#ingot-policy');
            await openView(page, 'View: Toggle Policy', view);
            await expect(view.locator('#ingot-policy-effective')).toContainText('apps/api/src');
            await expect(view.locator('[data-policy-row="Model"]')).toHaveText('ollama-local (apps/api/.ingot/policy.yaml)');
            await expect(view.locator('[data-policy-row="Max cost per run"]')).toHaveText('$5.00 (apps/api/.ingot/policy.yaml)');
            await expect(view.locator('[data-policy-row="Auto-approve"]')).toHaveText('commands (apps/api/.ingot/policy.yaml)');
            await expect(view.locator('#ingot-policy-files .ingot-policy-file.active')).toHaveCount(2);
            await saveShot(page, 'folder-policy', scheme);
        });
    }

    test('a run that would go over budget.maxCostPerRun stops before calling the model', async ({ page }) => {
        dir = makeProject('ingot-folder-budget-', FILES);
        server = await startFakeOllama(() => 'Should not be called.', { delayMs: 0 });
        await openWithScheme(page, 'light', dir);
        await connectOllama(page, server);
        await openFile(page, 'apps/legacy/old.ts');
        await expect(status(page)).toContainText('≤ $0.01');
        const auditBefore = auditLines().length;
        const callsBefore = server.requests.length;

        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await ask(page, 'refactor this file');
        await expect(page.locator('#ingot-agents .ingot-chat-system').filter({ hasText: 'Stopped: ' }).last()).toContainText('budget.maxCostPerRun of apps/legacy/.ingot/policy.yaml', { timeout: 30_000 });
        expect(server.requests.length).toBe(callsBefore);
        await expect.poll(() => auditLines().slice(auditBefore).some(entry => entry.reason?.startsWith('budget.maxCostPerRun'))).toBe(true);
    });

    test('Create Folder Policy writes a policy in the chosen folder', async ({ page }) => {
        dir = makeProject('ingot-folder-new-', FILES);
        await openWithScheme(page, 'light', dir);
        await runCommand(page, 'Agents: Create Folder Policy…');
        await answer(page, 'apps/web', 'Folder for the new policy');
        await expect(page.locator('.lm-TabBar-tab.lm-mod-current, .p-TabBar-tab.p-mod-current').filter({ hasText: 'policy.yaml' }).first()).toBeVisible();
        const view = page.locator('#ingot-policy');
        await openView(page, 'View: Toggle Policy', view);
        await expect(view.locator('#ingot-policy-files [data-file="apps/web/.ingot/policy.yaml"]')).toBeVisible();
    });
});
