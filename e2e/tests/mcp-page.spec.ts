import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { CALC_SERVER, CONFIG_PROJECT, E2E_CONFIG_DIR } from '../src/e2e.consts';

const pageRoot = (page: Page) => page.locator('.ingot-mcp');
const row = (page: Page, name: string) => page.locator(`#ingot-mcp-row-${name}`);
const GLOBAL_MCP = path.join(E2E_CONFIG_DIR, 'mcp.json');
const GLOBAL_RULE = path.join(E2E_CONFIG_DIR, 'rules', 'e2e-style.md');

const openPage = async (page: Page): Promise<void> => {
    await openIngot(page, CONFIG_PROJECT);
    await dismissNotifications(page);
    await page.locator('#ingot-rs-mcp').click();
    await expect(pageRoot(page)).toBeVisible();
};

const confirmDialog = async (page: Page): Promise<void> => {
    await page.locator('.dialogBlock .theia-button.main').click();
};

const addStdio = async (page: Page, name: string, args: string, env: { key: string; value: string; secret: boolean }[]): Promise<void> => {
    await page.locator('#ingot-mcp-add-server').click();
    const dialog = page.locator('#ingot-mcp-server-dialog');
    await dialog.locator('input[name=name]').fill(name);
    await dialog.locator('input[name=command]').fill('node');
    await dialog.locator('input[name=args]').fill(args);
    for (const [i, kv] of env.entries()) {
        await dialog.locator('[data-kind=env] .ingot-mcp-kv-add').click();
        const r = dialog.locator('[data-kind=env] .ingot-mcp-kvrow').nth(i);
        await r.locator('.ingot-mcp-kv-key').fill(kv.key);
        if (kv.secret) {
            await r.locator('.ingot-mcp-kv-secret').check();
        }
        if (kv.value) {
            await r.locator('.ingot-mcp-kv-value').fill(kv.value);
        }
    }
    await dialog.locator('select[name=scope]').selectOption('user');
    await dialog.locator('button[type=submit]').click();
    await expect(dialog).toBeHidden();
};

const removeServer = async (page: Page, name: string): Promise<void> => {
    if (!await row(page, name).count()) {
        return;
    }
    if (!await row(page, name).locator('.ingot-mcp-remove').isVisible()) {
        await row(page, name).locator('.ingot-mcp-row-main').click();
    }
    await row(page, name).locator('.ingot-mcp-remove').click();
    await confirmDialog(page);
    await expect(row(page, name)).toHaveCount(0);
};

test.describe('IDEA-62 Rules & MCP page', () => {
    test.afterAll(() => {
        fs.rmSync(GLOBAL_MCP, { force: true });
        fs.rmSync(path.dirname(GLOBAL_RULE), { recursive: true, force: true });
    });

    test('add, connect, toggle tools, restart, authenticate, show output and remove MCP servers', async ({ page }) => {
        await openPage(page);
        for (const pill of ['Plugins', 'MCPs', 'Skills', 'Subagents', 'Rules', 'Commands', 'Hooks']) {
            await expect(page.locator('.ingot-mcp-pills')).toContainText(pill);
        }
        await expect(page.locator('#ingot-mcp-search')).toHaveAttribute('placeholder', 'Search Plugins, Skills, MCPs…');

        // Project server (off until trusted) and the imported global one, both labelled.
        await expect(row(page, 'calc')).toContainText('Project');
        await expect(page.locator('#ingot-mcp-disabled')).toContainText('calc');
        await expect(row(page, 'imported-calc')).toContainText('Imported');

        // Add a global stdio server with a keychain secret: it connects and its secret never reaches mcp.json.
        await addStdio(page, 'e2e-calc', `"${CALC_SERVER}"`, [{ key: 'CALC_MODE', value: 'e2e', secret: false }, { key: 'CALC_TOKEN', value: 'e2e-secret-value', secret: true }]);
        await expect(page.locator('#ingot-mcp-connected')).toContainText('e2e-calc', { timeout: 20_000 });
        await expect(row(page, 'e2e-calc')).toContainText('Global');
        await expect(row(page, 'e2e-calc')).toContainText(/\d+ tools enabled/);
        const json = fs.readFileSync(GLOBAL_MCP, 'utf8');
        expect(json).toContain('"CALC_TOKEN": "${keychain}"');
        expect(json).not.toContain('e2e-secret-value');

        // Per-tool toggles.
        await row(page, 'e2e-calc').locator('.ingot-mcp-row-main').click();
        const addTool = row(page, 'e2e-calc').locator('.ingot-mcp-tool-toggle[data-tool=add]');
        await expect(addTool).toBeChecked();
        await addTool.uncheck();
        await expect(row(page, 'e2e-calc')).toContainText(/1 of 2 tools/);
        await addTool.check();
        await row(page, 'e2e-calc').locator('.ingot-mcp-restart').click();
        await expect(page.locator('#ingot-mcp-connected')).toContainText('e2e-calc', { timeout: 20_000 });

        // Edit keeps the secret in the keychain (shown as a secret row without its value).
        await row(page, 'e2e-calc').locator('.ingot-mcp-edit').click();
        const dialog = page.locator('#ingot-mcp-server-dialog');
        await expect(dialog.locator('input[name=args]')).toHaveValue(new RegExp('calc-server.mjs'));
        await expect(dialog.locator('[data-kind=env] .ingot-mcp-kv-secret').nth(1)).toBeChecked();
        await expect(dialog.locator('[data-kind=env] .ingot-mcp-kv-value').nth(1)).toHaveValue('');
        await dialog.getByRole('button', { name: 'Cancel' }).click();

        // A server whose secret is missing needs authentication.
        await addStdio(page, 'e2e-auth', `"${CALC_SERVER}"`, [{ key: 'API_TOKEN', value: '', secret: true }]);
        await expect(page.locator('#ingot-mcp-attention')).toContainText('e2e-auth', { timeout: 20_000 });
        await expect(row(page, 'e2e-auth')).toContainText('Needs authentication');
        await row(page, 'e2e-auth').locator('.ingot-mcp-authenticate').click();
        await row(page, 'e2e-auth').locator('input[name=API_TOKEN]').fill('token-from-e2e');
        await row(page, 'e2e-auth').getByRole('button', { name: 'Save & Connect' }).click();
        await expect(page.locator('#ingot-mcp-connected')).toContainText('e2e-auth', { timeout: 20_000 });

        // A broken server lands in Needs Attention with its output.
        await addStdio(page, 'e2e-broken', 'does-not-exist.mjs', []);
        await expect(page.locator('#ingot-mcp-attention')).toContainText('e2e-broken', { timeout: 20_000 });
        await row(page, 'e2e-broken').locator('.ingot-mcp-output-link').click();
        await expect(row(page, 'e2e-broken').locator('.ingot-mcp-output')).toBeVisible();

        if (process.env.INGOT_SHOTS_DIR) {
            await row(page, 'e2e-broken').locator('.ingot-mcp-output-link').click();
            await page.screenshot({ path: path.join(process.env.INGOT_SHOTS_DIR, 'mcp-page.png') });
            await row(page, 'e2e-broken').locator('.ingot-mcp-output-link').click();
        }

        // Search filters rows.
        await page.locator('#ingot-mcp-search').fill('e2e-');
        await expect(row(page, 'calc')).toHaveCount(0);
        await page.locator('#ingot-mcp-search').fill('');

        for (const name of ['e2e-broken', 'e2e-auth', 'e2e-calc']) {
            await removeServer(page, name);
        }
        expect(fs.readFileSync(GLOBAL_MCP, 'utf8')).not.toContain('e2e-calc');
    });

    test('marketplace lists popular apps with one-click add forms', async ({ page }) => {
        await openPage(page);
        await page.locator('#ingot-mcp-browse').click();
        const market = page.locator('#ingot-mcp-marketplace');
        // IDEA-123: 50 servers in category sections.
        await expect(market.locator('.ingot-mcp-card')).toHaveCount(50);
        for (const app of ['GitHub', 'GitLab', 'Linear', 'Slack', 'Supabase', 'Neon', 'Stripe', 'Resend', 'Gmail', 'Docker', 'Google Calendar', 'AWS', 'Cloudflare', 'MongoDB', 'Context7']) {
            await expect(market).toContainText(app);
        }
        await expect(market.locator('.ingot-mcp-category h4').first()).toContainText('Developer & Design');
        await expect(market.locator('.ingot-mcp-category[data-category="databases"] [data-entry="redis"]')).toBeVisible();
        await market.locator('.ingot-mcp-chip[data-category="cloud"]').click();
        await expect(market.locator('.ingot-mcp-category')).toHaveCount(1);
        await expect(market.locator('.ingot-mcp-category[data-category="cloud"] [data-entry="aws"]')).toBeVisible();
        await expect(market.locator('[data-entry="github"]')).toHaveCount(0);
        await market.locator('.ingot-mcp-chip[data-category="all"]').click();
        await page.locator('#ingot-mcp-search').fill('resend');
        await expect(market.locator('.ingot-mcp-card')).toHaveCount(1);
        await market.locator('.ingot-mcp-add').click();
        const form = page.locator('#ingot-mcp-addform');
        await expect(form.locator('input[name=RESEND_API_KEY]')).toHaveAttribute('type', 'password');
        await expect(form).toContainText('stored in OS keychain');
        await form.getByRole('button', { name: 'Cancel' }).click();
        await expect(form).toBeHidden();
    });

    test('rules, commands and skills show their scope; new global rules can be created and deleted', async ({ page }) => {
        await openPage(page);
        await page.locator('#ingot-mcp-tab-rules').click();
        const rules = page.locator('#ingot-mcp-items-rule');
        await expect(rules).toContainText('AGENTS.md');
        await expect(rules.locator('[data-item="team-style"]')).toContainText('Imported');

        await page.locator('#ingot-mcp-new-rule').click();
        const form = page.locator('#ingot-mcp-newitem');
        await form.locator('input[name=name]').fill('E2E Style');
        await form.locator('select[name=scope]').selectOption('user');
        await form.getByRole('button', { name: 'Create' }).click();
        await expect.poll(() => fs.existsSync(GLOBAL_RULE)).toBe(true);
        await expect(rules.locator('[data-item="e2e-style"]')).toContainText('Global');
        await expect(page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: 'e2e-style.md' })).toBeVisible();

        await page.locator('#ingot-rs-mcp').click();
        await page.locator('#ingot-mcp-tab-rules').click();
        await rules.locator('[data-item="e2e-style"] .ingot-mcp-item-delete').click();
        await confirmDialog(page);
        await expect(rules.locator('[data-item="e2e-style"]')).toHaveCount(0);
        expect(fs.existsSync(GLOBAL_RULE)).toBe(false);

        await page.locator('#ingot-mcp-tab-commands').click();
        await expect(page.locator('#ingot-mcp-items-command')).toContainText('/explain');
        await page.locator('#ingot-mcp-tab-skills').click();
        await expect(page.locator('#ingot-mcp-items-skill [data-item="release-notes"]')).toContainText('Project');
    });
});
