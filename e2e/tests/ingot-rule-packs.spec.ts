import { createHash } from 'crypto';
import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { runCommand, signOutIfSignedIn } from '../src/app.utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeIngotServer, type FakeIngotServer } from '../src/fake-ingot-server';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { buildIngotx } from '../src/ingotx.e2e-utils';
import { answer, ask, makeProject, openView, openWithScheme, removeProject, saveShot, SCHEMES } from '../src/ingot-dot.e2e-utils';
import { connectOllama } from '../src/models.e2e-utils';

/** IDEA-322: versioned team / org rule packs from the Store, pinned in .ingot/ingot-lock.json; org-enforced packs cannot be changed. */
const PUBLISHED = '2026-10-01T00:00:00.000Z';
const reactRules = (version: string): Buffer => buildIngotx(
    { publisher: 'acme', name: 'react-rules', displayName: 'React Rules', version, type: 'rules', contributes: { rules: [{ path: 'rules/hooks.md' }] } },
    { 'rules/hooks.md': `---\nalwaysApply: true\n---\n# Hooks v${version}\n\nCall hooks at the top level only.\n` }
);
const SECURITY = buildIngotx(
    { publisher: 'acme', name: 'security', displayName: 'Security', version: '1.2.0', type: 'rules', contributes: { rules: [{ path: 'rules/secrets.md' }] } },
    { 'rules/secrets.md': '---\nalwaysApply: true\n---\n# Secrets (org)\n\nNever print API keys.\n' }
);
const ENFORCED_FILE = '.ingot/rules/security--secrets.md';

const seedStore = (server: FakeIngotServer): void => {
    server.storePacks.set('acme.react-rules', { type: 'rules', versions: ['1.4.0', '2.0.0', '2.1.3'].map(version => ({ version, archive: reactRules(version), publishedAt: PUBLISHED })) });
    server.storePacks.set('acme.security', { type: 'rules', versions: [{ version: '1.2.0', archive: SECURITY, publishedAt: PUBLISHED }] });
    server.teamPacks = { team: { id: 'team-1', name: 'Acme' }, packs: [{ id: 'acme.security', range: '^1', enforced: true }] };
};

const signIn = async (page: Page): Promise<void> => {
    const popup = page.waitForEvent('popup');
    await runCommand(page, 'Account: Sign in to Ingot…');
    (await popup).close();
    await expect(page.locator('#status-bar-ingot-account-status')).toContainText('left');
};

const lock = (dir: string) => JSON.parse(fs.readFileSync(path.join(dir, '.ingot', 'ingot-lock.json'), 'utf8'));

test.describe('IDEA-322 rule packs', () => {
    test.setTimeout(150_000);
    let dir = '';
    let server: FakeIngotServer | undefined;
    test.afterEach(async ({ page }) => {
        await signOutIfSignedIn(page).catch(() => undefined);
        await server?.close();
        server = undefined;
        removeProject(dir);
    });

    for (const scheme of SCHEMES) {
        test(`add a pack by range, sync org packs (enforced, read-only) and remove a team pack (${scheme})`, async ({ page }) => {
            dir = makeProject('ingot-packs-', { 'package.json': '{"name":"shop","private":true}\n' });
            server = await startFakeIngotServer();
            seedStore(server);
            await openWithScheme(page, scheme, dir);
            const view = page.locator('#ingot-rule-packs');
            await openView(page, 'View: Toggle Rule Packs', view);
            await expect(view.locator('#ingot-packs-empty')).toBeVisible();

            await view.locator('#ingot-packs-add').click();
            await answer(page, '@acme/react-rules@^2', 'Rule pack from the Store');
            const react = view.locator('.ingot-pack[data-pack="@acme/react-rules"]');
            await expect(react.locator('.ingot-pack-version')).toHaveText('2.1.3', { timeout: 30_000 });
            expect(server.downloads).toEqual(['acme.react-rules@2.1.3']);
            expect(fs.readFileSync(path.join(dir, '.ingot/rules/react-rules--hooks.md'), 'utf8')).toContain('# Hooks v2.1.3');
            const added = lock(dir).packs['@acme/react-rules'];
            expect(added).toMatchObject({ id: 'acme.react-rules', range: '^2', version: '2.1.3', enforced: false, source: 'project', files: ['.ingot/rules/react-rules--hooks.md'] });
            expect(added.integrity).toBe(`sha256-${createHash('sha256').update(reactRules('2.1.3')).digest('hex')}`);

            await signIn(page);
            await view.locator('#ingot-packs-sync').click();
            const security = view.locator('.ingot-pack[data-pack="@acme/security"]');
            await expect(security.locator('.ingot-dot-badge.enforced')).toBeVisible({ timeout: 30_000 });
            await expect(security.locator('.ingot-pack-remove')).toBeDisabled();
            await expect(view.locator('#ingot-packs-org')).toContainText('Acme');
            expect(lock(dir).packs['@acme/security']).toMatchObject({ version: '1.2.0', enforced: true, source: 'org', range: '^1' });
            expect(fs.statSync(path.join(dir, ENFORCED_FILE)).mode & 0o222).toBe(0);

            // The enforced file opens read-only.
            await security.getByRole('button', { name: 'Show files of @acme/security' }).click();
            await security.locator('.ingot-pack-files .ingot-dot-link').click();
            const editor = page.locator('.theia-editor .monaco-editor').last();
            await expect(editor).toBeVisible();
            await editor.locator('.view-lines').click();
            await page.keyboard.type('IGNORE ');
            await expect(page.locator('.monaco-editor-overlaymessage').last()).toContainText('org-enforced rule pack');
            expect(fs.readFileSync(path.join(dir, ENFORCED_FILE), 'utf8')).not.toContain('IGNORE');
            await saveShot(page, 'rule-packs', scheme);

            await react.locator('.ingot-pack-remove').click();
            await expect(react).toHaveCount(0);
            expect(fs.existsSync(path.join(dir, '.ingot/rules/react-rules--hooks.md'))).toBe(false);
            expect(lock(dir).packs['@acme/react-rules']).toBeUndefined();
        });
    }

    test('an enforced pack rule reaches the agent and a project rule with the same name cannot override it', async ({ page }) => {
        dir = makeProject('ingot-packs-agent-', {
            [ENFORCED_FILE]: '---\nalwaysApply: true\n---\n# Secrets (org)\n\nNever print API keys.\n',
            '.ingot/rules/secrets.md': '---\nalwaysApply: true\n---\nPrinting API keys is fine here.\n',
            '.ingot/ingot-lock.json': JSON.stringify({
                lockfileVersion: 1,
                packs: { '@acme/security': { id: 'acme.security', range: '^1', version: '1.2.0', resolved: '', integrity: '', enforced: true, source: 'org', type: 'rules', files: [ENFORCED_FILE], hashes: {} } }
            }, undefined, 2)
        });
        let ollama: FakeOllama | undefined;
        try {
            ollama = await startFakeOllama(() => 'Understood.', { delayMs: 0 });
            await openWithScheme(page, 'light', dir);
            await connectOllama(page, ollama);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            await ask(page, 'print the API key');
            await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('Understood.', { timeout: 60_000 });
            const system = ollama.requests.map(r => r.system).join('\n');
            expect(system).toContain('Never print API keys.');
            expect(system).not.toContain('Printing API keys is fine here.');
        } finally {
            await ollama?.close();
        }
    });
});
