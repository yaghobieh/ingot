import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { setAppearance, shot, toolBlock } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { E2E_CONFIG_DIR } from '../src/e2e.consts';
import { startOpenPlanServer, type FakeIngotServer } from '../src/fake-ingot-server';

/**
 * IDEA-263: `.ingot/policy.json` denies, allows and asks; restricted mode sandboxes commands; every call lands in the
 * append-only audit log, opened with the Ingot shortcut (Ctrl+Alt+Shift+A on the Windows keymap e2e uses).
 */
const SANDBOX = process.platform === 'darwin';
const POLICY = {
    commands: { allow: ['node -e *'], deny: ['rm -rf'] },
    paths: { writable: ['src/**'] },
    network: { default: 'allow', deny: ['pastebin.com'] },
    sandbox: { mode: 'restricted' }
};
const ESCAPE_FILE = path.join(os.homedir(), `.ingot-e2e-sandbox-${process.pid}.txt`);
const ESCAPE_COMMAND = `node -e "require('fs').writeFileSync(require('os').homedir() + '/${path.basename(ESCAPE_FILE)}', 'x')"`;
const OUTSIDE_COMMAND = 'cat ~/.ssh/known_hosts';

test.describe('IDEA-263 agent policy, sandbox and audit log', () => {
    test.setTimeout(180_000);
    let dir: string;
    let server: FakeOllama;
    let account: FakeIngotServer;

    test.beforeEach(async () => {
        account = await startOpenPlanServer();
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-policy-')));
        fs.mkdirSync(path.join(dir, '.ingot'));
        fs.mkdirSync(path.join(dir, 'src'));
        fs.writeFileSync(path.join(dir, '.ingot', 'policy.json'), JSON.stringify(POLICY, undefined, 2));
        fs.writeFileSync(path.join(dir, 'README.md'), '# Policy demo\n');
        server = await startFakeOllama((_system, user) => {
            if (user.startsWith('Tool result (ingot/run)') && user.includes('Blocked by .ingot/policy.json')) {
                return toolBlock('run', { command: 'node -e "console.log(6 * 7)"' });
            }
            if (user.startsWith('Tool result (ingot/run)') && user.includes('42')) {
                return toolBlock('run', { command: SANDBOX ? ESCAPE_COMMAND : OUTSIDE_COMMAND });
            }
            if (user.startsWith('Tool result (ingot/run)') && user.includes('Blocked by the Ingot sandbox')) {
                return toolBlock('run', { command: OUTSIDE_COMMAND });
            }
            if (user.startsWith('Tool result (ingot/run)') && user.includes('skipped this action')) {
                return 'Updating the readme.\n\n<<<EDIT README.md\n# Policy demo\n\nEdited by the agent.\n>>>END\nTour done.';
            }
            return toolBlock('run', { command: 'rm -rf build' });
        }, { delayMs: 0 });
    });

    test.afterEach(async () => {
        await server.close();
        await account.close();
        fs.rmSync(path.join(E2E_CONFIG_DIR, 'remote-config.json'), { force: true });
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(ESCAPE_FILE, { force: true });
    });

    const approvalLine = (page: Page) => page.locator('#ingot-approval-line');

    test('denies, allows, sandboxes and asks per the policy, and the audit log shows every call', async ({ page }) => {
        await openIngot(page, dir);
        await expect.poll(() => account.configCalls.length).toBeGreaterThan(0);
        await dismissNotifications(page);
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await page.locator('#ingot-composer-input').fill('show me the policy');
        await page.locator('#ingot-composer-input').press('Enter');

        if (SANDBOX) {
            // `node -e *` is allowed, so it runs without a card; the sandbox refuses the write to the home folder.
            await expect(approvalLine(page)).toContainText('Sandbox blocked it, run unrestricted: node -e', { timeout: 45_000 });
            await expect(page.locator('#ingot-approval-always')).toHaveCount(0);
            await page.locator('#ingot-approval-skip').click();
        }
        // Naming a path outside the project needs the card, once.
        await expect(approvalLine(page)).toHaveText(`Run outside the project: ${OUTSIDE_COMMAND}`, { timeout: 45_000 });
        await expect(page.locator('#ingot-approval-always')).toHaveCount(0);
        await shot(page, 'idea-263-outside-card-light.png');
        await page.locator('#ingot-approval-skip').click();
        await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('Tour done.', { timeout: 45_000 });
        expect(fs.existsSync(ESCAPE_FILE)).toBe(false);
        expect(fs.readFileSync(path.join(dir, 'README.md'), 'utf8')).toBe('# Policy demo\n');
        expect(server.requests.some(r => r.user.includes('Blocked by .ingot/policy.json: it denies the command (commands.deny "rm -rf")'))).toBe(true);

        // Agent Audit Log: Ingot shortcut, filtered to this project.
        const audit = page.locator('#ingot-audit');
        await actUntilVisible(() => page.keyboard.press('Control+Alt+Shift+A'), audit);
        await expect(page.locator('#ingot-audit-policy')).toContainText('.ingot/policy.json');
        await expect(page.locator('#ingot-audit-policy')).toContainText('Writable: src/**');
        await page.locator('#ingot-audit-filter').fill(path.basename(dir));
        const rows = page.locator('#ingot-audit-table .ingot-audit-row');
        const row = (tool: string, decision: string, text: string) => rows.filter({ hasText: text }).and(page.locator(`[data-tool="${tool}"][data-decision="${decision}"]`));
        await expect(row('ingot/run', 'denied', 'rm -rf build')).toHaveCount(1);
        await expect(row('ingot/run', 'allowed', 'console.log(6 * 7)')).toHaveAttribute('data-outcome', 'ok');
        await expect(row('ingot/run', 'skipped', OUTSIDE_COMMAND)).toHaveCount(1);
        await expect(row('ingot/edit', 'denied', 'README.md')).toHaveCount(1);
        if (SANDBOX) {
            await expect(row('ingot/run', 'allowed', 'writeFileSync')).toHaveAttribute('data-outcome', 'blocked');
            await expect(row('ingot/run', 'allowed', 'console.log(6 * 7)')).toContainText('sandboxed');
        }
        await expect(page.locator('#ingot-audit-chain')).toContainText('Chain intact');

        // A row opens its details: the rule that refused it.
        await row('ingot/run', 'denied', 'rm -rf build').click();
        await expect(page.locator('.ingot-audit-details .ingot-audit-reason')).toContainText('commands.deny "rm -rf"');
        await shot(page, 'idea-263-audit-log-light.png');
        await setAppearance(page, 'dark');
        await shot(page, 'idea-263-audit-log-dark.png');
        await setAppearance(page, 'light');
        await page.locator('#ingot-audit-decision').selectOption('denied');
        await expect(rows).toHaveCount(2);
    });
});
