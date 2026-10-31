import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot, runCommand } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { makeToolsProject, setAppearance, shot, toolBlock } from '../src/agent-tools.e2e-utils';
import { createTempRepo } from '../src/git-repo';

/**
 * IDEA-288: sandbox / approval presets in the composer, saved in .ingot/policy.json and enforced on the run tool.
 * IDEA-293: Review Changes on the local diff, findings in the Review panel and editor, Fix with agent.
 */
const AUTO_REVIEWER = 'security reviewer';
const CODE_REVIEWER = 'senior code reviewer';
const NETWORK_COMMAND = 'curl --version';
const PILL = '#ingot-composer-sandbox';

const ask = async (page: Page, text: string): Promise<void> => {
    await page.locator('#ingot-composer-input').fill(text);
    await page.locator('#ingot-composer-input').press('Enter');
};

const start = async (page: Page, dir: string, server: FakeOllama): Promise<void> => {
    await openIngot(page, dir);
    await dismissNotifications(page);
    await connectOllama(page, server);
    await page.locator('#ingot-agents-new').click();
    await pickModel(page, 'ollama-local');
};

const readPreset = (dir: string): Record<string, unknown> | undefined => {
    try {
        return (JSON.parse(fs.readFileSync(path.join(dir, '.ingot', 'policy.json'), 'utf8')) as { preset?: Record<string, unknown> }).preset;
    } catch {
        return undefined;
    }
};

test.describe('IDEA-288 sandbox presets and IDEA-293 code review', () => {
    test.setTimeout(240_000);
    let dir: string;
    let server: FakeOllama;

    test.afterEach(async () => {
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('the composer preset gates network commands: Ask shows the card, Never refuses, Auto-review runs low risk', async ({ page }) => {
        dir = makeToolsProject('ingot-sandbox-');
        server = await startFakeOllama((system, user) => {
            if (system.includes(AUTO_REVIEWER)) {
                return '{"risk":"low","reason":"Prints the curl version only."}';
            }
            if (user.startsWith('Tool result (ingot/run)')) {
                return user.includes('Blocked by the Ingot sandbox') ? 'The sandbox blocked it.' : 'Curl is installed.';
            }
            return toolBlock('run', { command: NETWORK_COMMAND });
        }, { delayMs: 0 });
        await start(page, dir, server);

        const pill = page.locator(PILL);
        await expect(pill).toContainText('Workspace · Ask');
        await expect(pill).toHaveAttribute('data-network', 'false');

        // Ask: the network leaves the workspace-write sandbox, so the card says why and offers no Always Run.
        await ask(page, 'check curl');
        await expect(page.locator('#ingot-approval-sandbox')).toContainText('uses the network', { timeout: 30_000 });
        await expect(page.locator('#ingot-approval-always')).toHaveCount(0);
        await shot(page, 'idea-288-card-light.png');
        await page.locator('#ingot-approval-run').click();
        await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('Curl is installed.', { timeout: 30_000 });

        // Never: picked in the composer, saved for the project, and the command is refused without a card.
        await pill.click();
        await expect(page.locator('#ingot-sandbox-menu')).toBeVisible();
        await shot(page, 'idea-288-picker-light.png');
        await page.locator('#ingot-sandbox-approvals-never').click();
        await expect(pill).toContainText('Workspace · Never');
        await expect.poll(() => readPreset(dir)).toMatchObject({ sandbox: 'workspace-write', approvals: 'never' });
        await page.keyboard.press('Escape');
        await ask(page, 'check curl again');
        await expect(page.locator('#ingot-agents .ingot-chat-agent', { hasText: 'The sandbox blocked it.' })).toHaveCount(1, { timeout: 30_000 });
        await expect(page.locator('#ingot-approval')).toHaveCount(0);

        // Auto-review: the cheap-model risk check says low, so it runs without a card.
        await pill.click();
        await page.locator('#ingot-sandbox-approvals-auto-review').click();
        await expect(pill).toContainText('Workspace · Auto');
        await expect.poll(() => readPreset(dir)).toMatchObject({ approvals: 'auto-review' });
        await page.keyboard.press('Escape');
        await ask(page, 'check curl once more');
        await expect(page.locator('#ingot-agents')).toContainText('Auto-review: low risk', { timeout: 30_000 });
        await expect(page.locator('#ingot-agents .ingot-chat-agent', { hasText: 'Curl is installed.' })).toHaveCount(2, { timeout: 30_000 });
        expect(server.requests.some(r => r.system.includes(AUTO_REVIEWER) && r.user.includes(NETWORK_COMMAND))).toBe(true);

        // Network on: the command stays inside the sandbox again.
        await pill.click();
        await page.locator('#ingot-sandbox-network').click();
        await expect(pill).toHaveAttribute('data-network', 'true');
        await expect.poll(() => readPreset(dir)).toMatchObject({ network: true });
        await page.keyboard.press('Escape');
        await expect(page.locator('#ingot-sandbox-menu')).toHaveCount(0);
        await setAppearance(page, 'dark');
        await pill.click();
        await expect(page.locator('#ingot-sandbox-menu')).toBeVisible();
        await shot(page, 'idea-288-picker-dark.png');
        await page.keyboard.press('Escape');
        await setAppearance(page, 'light');
    });

    test('Review Changes shows findings in the Review panel and the editor, and Fix with agent starts a chat', async ({ page }) => {
        dir = createTempRepo();
        fs.writeFileSync(path.join(dir, 'src', 'math.ts'), [
            'export const add = (a: number, b: number): number => a + b;',
            'export const sub = (a: number, b: number): number => b - a;',
            ''
        ].join('\n'));
        server = await startFakeOllama(system => {
            if (system.includes(CODE_REVIEWER)) {
                return JSON.stringify([
                    { path: 'src/math.ts', line: 2, severity: 'high', title: 'sub subtracts in the wrong order', detail: 'Return a - b instead of b - a.' },
                    { path: 'src/math.ts', line: 2, severity: 'low', title: 'sub has no test', detail: 'Add a unit test for sub.' }
                ]);
            }
            return 'I will swap the operands.';
        }, { delayMs: 0 });
        await start(page, dir, server);

        await runCommand(page, 'Ingot: Review Changes');
        const panel = page.locator('#ingot-code-review');
        await expect(panel).toBeVisible();
        const high = panel.locator('.ingot-cr-finding[data-severity="high"]');
        await expect(high).toContainText('sub subtracts in the wrong order', { timeout: 30_000 });
        await expect(panel.locator('.ingot-cr-finding')).toHaveCount(2);
        await expect(panel.locator('#ingot-code-review-label')).toContainText('Local changes');
        const request = server.requests.find(r => r.system.includes(CODE_REVIEWER));
        expect(request?.user).toContain('+export const sub = (a: number, b: number): number => b - a;');

        // The row opens the file; the finding is an editor diagnostic.
        await high.click();
        await expect(page.locator('.monaco-editor .squiggly-error').first()).toBeAttached({ timeout: 15_000 });
        await shot(page, 'idea-293-review-light.png');

        await high.locator('.ingot-cr-fix').click();
        await expect(page.locator('#ingot-agents .ingot-chat-user').last()).toContainText('Fix this code review finding in src/math.ts at line 2', { timeout: 15_000 });
        await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('I will swap the operands.', { timeout: 30_000 });
        expect(server.requests.some(r => !r.system.includes(CODE_REVIEWER) && r.users.some(u => u.includes('Return a - b instead of b - a.')))).toBe(true);

        await setAppearance(page, 'dark');
        await shot(page, 'idea-293-review-dark.png');
        await setAppearance(page, 'light');
    });
});
