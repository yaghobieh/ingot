import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot, signOutIfSignedIn } from '../src/app.utils';
import { signInToIngot } from '../src/account.e2e-utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import { E2E_CONFIG_DIR } from '../src/e2e.consts';
import { startFakeIngotServer, type FakeIngotServer } from '../src/fake-ingot-server';

/**
 * IDEA-287: Settings › Team Rules lets team admins add, edit, enable and enforce team rules. With the server's
 * /v1/team/rules they are saved there and reach members through /v1/config; without it they stay in a local stub file.
 */
const STUB_FILE = path.join(E2E_CONFIG_DIR, 'team-rules.local.json');
const REMOTE_CONFIG_CACHE = path.join(E2E_CONFIG_DIR, 'remote-config.json');

const dialog = (page: Page): Locator => page.locator('#ingot-settings');
const editor = (page: Page): Locator => page.locator('#ingot-team-rules-editor');
const row = (page: Page, name: string): Locator => editor(page).locator(`[data-team-rule="${name}"]`);

const openTeamRules = async (page: Page): Promise<void> => {
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), dialog(page));
    await page.locator('#ingot-settings-node-team-rules').click();
    await expect(editor(page)).toBeVisible();
};
const closeSettings = async (page: Page): Promise<void> => {
    await page.locator('#ingot-settings-cancel').click();
    await expect(dialog(page)).toBeHidden();
};

const addRule = async (page: Page, name: string, body: string, options: { enforced?: boolean; globs?: string } = {}): Promise<void> => {
    await page.locator('#ingot-team-rules-add').click();
    await page.locator('#ingot-team-rule-name').fill(name);
    if (options.globs) {
        await page.locator('#ingot-team-rule-globs').fill(options.globs);
    }
    await page.locator('#ingot-team-rule-body').fill(body);
    if (options.enforced) {
        await page.locator('#ingot-team-rule-enforced').check();
    }
    await page.locator('#ingot-team-rule-save').click();
    await expect(row(page, name)).toBeVisible();
};

/** The Team Rules page in light and dark. */
const shots = async (page: Page, name: string): Promise<void> => {
    for (const scheme of ['light', 'dark'] as const) {
        await setAppearance(page, scheme);
        await openTeamRules(page);
        await shot(page, `${name}-${scheme}.png`);
        await closeSettings(page);
    }
};

test.describe('IDEA-287 Team Rules editor for admins', () => {
    test.setTimeout(180_000);
    let server: FakeIngotServer;

    test.beforeEach(async () => {
        fs.rmSync(STUB_FILE, { force: true });
        fs.rmSync(REMOTE_CONFIG_CACHE, { force: true });
        server = await startFakeIngotServer();
    });

    test.afterEach(async ({ page }) => {
        await setAppearance(page, 'dark').catch(() => undefined);
        await signOutIfSignedIn(page).catch(() => undefined);
        await server.close();
        fs.rmSync(STUB_FILE, { force: true });
        fs.rmSync(REMOTE_CONFIG_CACHE, { force: true });
    });

    test('with the server API: rules are saved on the team and enabled ones reach members', async ({ page }) => {
        server.role = 'admin';
        server.teamRulesApi = true;
        server.teamRules = [{ name: 'api-style', body: 'Use REST with plural nouns.', enabled: true }];
        await openIngot(page);
        await dismissNotifications(page);
        await signInToIngot(page);

        await openTeamRules(page);
        await expect(page.locator('#ingot-team-rules-store')).toContainText('Saved on your Ingot team');
        await expect(row(page, 'api-style')).toBeVisible();
        await addRule(page, 'no-console', 'Never leave console.log in committed code.', { enforced: true, globs: 'src/**/*.ts' });
        await expect(row(page, 'no-console')).toContainText('enforced');
        expect(server.teamRulesWrites.at(-1)).toContainEqual(expect.objectContaining({ name: 'no-console', enforced: true, globs: 'src/**/*.ts', enabled: true }));

        // Turning a rule into a draft keeps it on the server but members no longer get it.
        await row(page, 'api-style').getByRole('button', { name: 'Edit team rule api-style' }).click();
        await page.locator('#ingot-team-rule-enabled').uncheck();
        await page.locator('#ingot-team-rule-save').click();
        await expect(row(page, 'api-style')).toContainText('draft');
        expect(server.teamRulesWrites.at(-1)).toContainEqual(expect.objectContaining({ name: 'api-style', enabled: false }));
        await closeSettings(page);
        await shots(page, 'team-rules-server');

        // Members' view: User Rules › Team rules lists the published rule, enforced, and not the draft.
        await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), dialog(page));
        await page.locator('#ingot-settings-node-user-rules').click();
        const team = page.locator('#ingot-rules-team');
        await expect(team).toContainText('no-console');
        await expect(team).toContainText('enforced');
        await expect(team).not.toContainText('api-style');
        await closeSettings(page);
    });

    test('without the server API: rules are kept in a local stub with a TODO and apply on this machine', async ({ page }) => {
        server.role = 'admin';
        await openIngot(page);
        await dismissNotifications(page);
        await signInToIngot(page);

        await openTeamRules(page);
        await expect(page.locator('#ingot-team-rules-store')).toContainText('Saved on this machine only');
        await expect(page.locator('#ingot-team-rules-store')).toContainText('TODO');
        await addRule(page, 'review-checklist', 'Run npm run gate before every push.');
        await expect.poll(() => fs.existsSync(STUB_FILE)).toBe(true);
        const stub = JSON.parse(fs.readFileSync(STUB_FILE, 'utf8')) as { todo: string; rules: { name: string }[] };
        expect(stub.todo).toContain('TODO(IDEA-287)');
        expect(stub.rules.map(r => r.name)).toEqual(['review-checklist']);

        // A bad name is refused in place.
        await page.locator('#ingot-team-rules-add').click();
        await page.locator('#ingot-team-rule-name').fill('../escape');
        await page.locator('#ingot-team-rule-body').fill('x');
        await page.locator('#ingot-team-rule-save').click();
        await expect(editor(page).locator('.ingot-rules-error')).toContainText('Give the rule a name');
        await closeSettings(page);
        await shots(page, 'team-rules-local');

        await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), dialog(page));
        await page.locator('#ingot-settings-node-user-rules').click();
        await expect(page.locator('#ingot-rules-team')).toContainText('review-checklist');
        await closeSettings(page);
    });

    test('members who are not admins do not see the Team Rules page', async ({ page }) => {
        await openIngot(page);
        await dismissNotifications(page);
        await signInToIngot(page);
        await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), dialog(page));
        await expect(page.locator('#ingot-settings-node-user-rules')).toBeVisible();
        await expect(page.locator('#ingot-settings-node-team-rules')).toHaveCount(0);
        await closeSettings(page);
    });
});
