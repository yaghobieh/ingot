import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';

/**
 * IDEA-303 Frozen Zones: freeze a file from the project tree and a function from the editor menu (.ingot/frozen.json,
 * silver "Frozen" note). An agent edit to a frozen zone asks in the chat first; Keep sends the agent elsewhere, Allow
 * lets it through. Rejecting agent edits to a file again and again suggests freezing it ("Saved to Habits").
 * Settings › Frozen Zones unfreezes and infers stable files from green tests + an old last commit.
 */
const CHARGE = "export function charge(amount: number): number {\n    if (amount < 0) {\n        throw new Error('negative');\n    }\n    return amount;\n}\n";
const CHARGE_NEGATIVE = 'export function charge(amount: number): number {\n    return amount;\n}\n';
const UTIL = 'export function format(value: number): string {\n    return value.toFixed(2);\n}\n\nexport function label(name: string): string {\n    return name.trim();\n}\n';
const UTIL_LABEL = UTIL.replace('return name.trim();', 'return name.trim().toUpperCase();');
const UTIL_FORMAT = UTIL.replace('return value.toFixed(2);', 'return value.toFixed(0);');
const NOTES = "export const notes = 'v1';\n";
const FROZEN = '.ingot/frozen.json';
/** Two agent edits to notes.ts were rejected before; one more makes Ingot suggest freezing it. */
const SEED = { version: 1, zones: [], reverts: { 'src/notes.ts': 2 }, dismissed: [] };
const OLD_DATE = '2025-01-15T10:00:00Z';

const write = (dir: string, file: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
};
const read = (dir: string, file: string): string => fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), 'utf8') : '';
const zones = (dir: string): { id: string; source: string }[] => {
    try {
        return (JSON.parse(read(dir, FROZEN)) as { zones: { id: string; source: string }[] }).zones;
    } catch {
        return [];
    }
};

const gitEnv = { ...process.env, GIT_AUTHOR_DATE: OLD_DATE, GIT_COMMITTER_DATE: OLD_DATE };
const git = (cwd: string, ...args: string[]): string => execFileSync('git', ['-c', 'user.name=Ingot E2E', '-c', 'user.email=e2e@ingot.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main', ...args], { cwd, encoding: 'utf8', env: gitEnv });

/** A repo whose sources were last committed long ago; charge.ts has a test next to it and `npm test` is green. */
const makeProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-frozen-')));
    write(dir, 'package.json', `${JSON.stringify({ name: 'shop', private: true, scripts: { test: 'node -e "console.log(\'TESTS-GREEN\')"' } }, undefined, 2)}\n`);
    write(dir, 'src/payments/charge.ts', CHARGE);
    write(dir, 'src/payments/charge.test.ts', "import { charge } from './charge';\nconsole.assert(charge(1) === 1);\n");
    write(dir, 'src/util.ts', UTIL);
    write(dir, 'src/notes.ts', NOTES);
    git(dir, 'init', '-q');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'Initial commit');
    write(dir, FROZEN, `${JSON.stringify(SEED, undefined, 2)}\n`);
    return dir;
};

const edit = (file: string, body: string): string => `<<<EDIT ${file}\n${body.trimEnd()}\n>>>END`;
const composer = (page: Page) => page.locator('#ingot-composer-input');
const agentReplies = (page: Page) => page.locator('#ingot-agents .ingot-chat-agent');
const note = (page: Page, kind: string) => page.locator(`#ingot-agents .ingot-habit-note[data-note-kind="${kind}"]`);
const treeNode = (page: Page, name: string): Locator =>
    page.locator('#explorer-view-container .theia-TreeNode').filter({ has: page.locator('.theia-TreeNodeSegmentGrow').getByText(name, { exact: true }) }).first();
const menuItem = (page: Page, text: string): Locator =>
    page.locator('.lm-Menu').first().locator('.lm-Menu-item', { has: page.locator('.lm-Menu-itemLabel', { hasText: new RegExp(`^${text}$`) }) });

const openMenuOn = async (page: Page, target: Locator): Promise<void> => {
    await expect(async () => {
        if (await page.locator('.lm-Menu').first().isVisible()) {
            await page.keyboard.press('Escape');
        }
        // Move off the tab bar so a path tooltip can't cover the target.
        await page.mouse.move(600, 450);
        await page.waitForTimeout(300);
        await target.click({ button: 'right' });
        await expect(page.locator('.lm-Menu').first()).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: 20_000 });
};

const send = async (page: Page, text: string): Promise<void> => {
    await composer(page).fill(text);
    await composer(page).press('Enter');
};

const openSettingsPage = async (page: Page, id: string): Promise<void> => {
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), page.locator('#ingot-settings'));
    await page.locator(`#ingot-settings-node-${id}`).click();
};

const currentAppearance = async (page: Page): Promise<string> => {
    await openSettingsPage(page, 'appearance');
    const value = await page.locator('#ingot-setting-ingot-appearance').inputValue();
    await page.locator('#ingot-settings-cancel').click();
    return value;
};

const restoreAppearance = async (page: Page, appearance: string): Promise<void> => {
    if (await page.locator('#ingot-settings').isVisible()) {
        await page.locator('#ingot-settings-cancel').click();
    }
    await openSettingsPage(page, 'appearance');
    await page.locator('#ingot-setting-ingot-appearance').selectOption(appearance);
    await page.locator('#ingot-settings-ok').click();
};

test.describe('IDEA-303 Frozen Zones', () => {
    test.setTimeout(300_000);
    let dir: string;
    let server: FakeOllama;

    test.beforeEach(async () => {
        dir = makeProject();
        server = await startFakeOllama((_system, user) => {
            if (user.startsWith('let charge accept negatives')) {
                return `Removing the guard.\n\n${edit('src/payments/charge.ts', CHARGE_NEGATIVE)}`;
            }
            if (user.startsWith('The user kept src/payments/charge.ts frozen')) {
                return `Then I will upper-case labels instead.\n\n${edit('src/util.ts', UTIL_LABEL)}`;
            }
            if (user.startsWith('round the format output')) {
                return `Rounding to whole numbers.\n\n${edit('src/util.ts', UTIL_FORMAT)}`;
            }
            if (user.startsWith('bump the notes')) {
                return `Bumping.\n\n${edit('src/notes.ts', "export const notes = 'v2';\n")}`;
            }
            return 'OK.';
        }, { delayMs: 0 });
    });

    test.afterEach(async () => {
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('freeze from the tree and the editor, guarded agent edits, learned freeze, settings and inference', async ({ page }) => {
        await openIngot(page, dir);
        const appearance = await currentAppearance(page);
        try {
            await setAppearance(page, 'dark');
            await connectOllama(page, server);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            await dismissNotifications(page);

            // Project tree: Freeze for Agents.
            await expect(treeNode(page, 'src')).toBeVisible({ timeout: 30_000 });
            await treeNode(page, 'src').click();
            await treeNode(page, 'payments').click();
            await openMenuOn(page, treeNode(page, 'charge.ts'));
            await expect(menuItem(page, 'Freeze for Agents')).toBeVisible();
            await expect(menuItem(page, 'Unfreeze for Agents')).toHaveCount(0);
            await shot(page, 'IDEA-303-tree-menu-dark.png');
            await menuItem(page, 'Freeze for Agents').click();
            await expect(note(page, 'frozen').first()).toContainText('Frozen');
            await expect(note(page, 'frozen').first()).toContainText('src/payments/charge.ts');
            await expect.poll(() => zones(dir).map(z => z.id)).toEqual(['src/payments/charge.ts']);
            await openMenuOn(page, treeNode(page, 'charge.ts'));
            await expect(menuItem(page, 'Unfreeze for Agents')).toBeVisible();
            await expect(menuItem(page, 'Freeze for Agents')).toHaveCount(0);
            await page.keyboard.press('Escape');

            // Editor menu: Freeze Function for Agents freezes the function under the cursor.
            await treeNode(page, 'util.ts').dblclick();
            const code = page.locator('.monaco-editor:not(.monaco-diff-editor .monaco-editor) .view-lines span >> visible=true', { hasText: 'toFixed' }).first();
            await expect(code).toBeVisible({ timeout: 30_000 });
            await code.click();
            await openMenuOn(page, code);
            await menuItem(page, 'Freeze Function for Agents').click();
            await expect(note(page, 'frozen').last()).toContainText('src/util.ts › format');
            await expect.poll(() => zones(dir).map(z => z.id)).toEqual(['src/payments/charge.ts', 'src/util.ts#format']);

            // A frozen file: the agent asks; Keep sends it elsewhere and its edit outside the frozen function lands.
            await send(page, 'let charge accept negatives');
            const ask = page.locator('#ingot-ask');
            await expect(page.locator('#ingot-ask-question')).toHaveText('src/payments/charge.ts is frozen. Allow this edit?', { timeout: 60_000 });
            await expect(ask.locator('.ingot-ask-option')).toHaveText(['Keep it frozen', 'Allow this edit', 'Unfreeze']);
            const first = server.requests.find(r => r.user.startsWith('let charge accept negatives'))!;
            expect(first.system).toContain('Frozen zones (.ingot/frozen.json)');
            expect(first.system).toContain('- src/util.ts › format');
            await shot(page, 'IDEA-303-frozen-ask-dark.png');
            await setAppearance(page, 'light');
            await shot(page, 'IDEA-303-frozen-ask-light.png');
            await ask.locator('.ingot-ask-option', { hasText: 'Keep it frozen' }).click();
            await expect(agentReplies(page).last()).toContainText('Then I will upper-case labels instead.', { timeout: 60_000 });
            await expect.poll(() => read(dir, 'src/util.ts')).toBe(UTIL_LABEL);
            expect(read(dir, 'src/payments/charge.ts')).toBe(CHARGE);
            await expect(ask).toHaveCount(0);

            // A frozen function: Allow this edit lets it through.
            await send(page, 'round the format output');
            await expect(page.locator('#ingot-ask-question')).toHaveText('src/util.ts › format is frozen. Allow this edit?', { timeout: 60_000 });
            await ask.locator('.ingot-ask-option', { hasText: 'Allow this edit' }).click();
            await expect.poll(() => read(dir, 'src/util.ts')).toContain('value.toFixed(0)');

            // Rejecting agent edits to the same file again and again: Ingot suggests freezing it.
            await send(page, 'bump the notes');
            await expect(agentReplies(page).last()).toContainText('Bumping.', { timeout: 60_000 });
            await expect(page.locator('#ingot-changes-reject-all')).toBeVisible();
            await page.locator('#ingot-changes-reject-all').click();
            const suggestion = page.locator('#ingot-frozen-suggestions [data-path="src/notes.ts"]');
            await expect(suggestion).toContainText('You always revert agent edits to src/notes.ts. Freeze it?');
            await shot(page, 'IDEA-303-suggest-freeze-light.png');
            await suggestion.locator('.ingot-frozen-freeze').click();
            await expect(suggestion).toHaveCount(0);
            await expect(note(page, 'frozen').last()).toContainText('src/notes.ts');
            await expect(note(page, 'habit').last()).toContainText('Saved to Habits');
            await expect.poll(() => zones(dir).find(z => z.id === 'src/notes.ts')?.source).toBe('learned');
            await expect.poll(() => read(dir, '.ingot/habits.json')).toContain('"key": "frozen:src/notes.ts"');
            await shot(page, 'IDEA-303-notes-light.png');
            await setAppearance(page, 'dark');
            await shot(page, 'IDEA-303-notes-dark.png');

            // Settings › Frozen Zones: unfreeze, then infer stable files from the green tests + old commit.
            await openSettingsPage(page, 'frozen');
            const manager = page.locator('#ingot-frozen-manager');
            await expect(manager.locator('[data-zone="src/notes.ts"]')).toContainText('you kept reverting it');
            await expect(manager.locator('[data-zone="src/util.ts#format"]')).toContainText('src/util.ts › format');
            await shot(page, 'IDEA-303-settings-dark.png');
            await manager.locator('[data-zone="src/payments/charge.ts"] .ingot-frozen-unfreeze').click();
            await expect(manager.locator('[data-zone="src/payments/charge.ts"]')).toHaveCount(0);
            await expect.poll(() => zones(dir).map(z => z.id)).not.toContain('src/payments/charge.ts');
            await page.locator('#ingot-frozen-infer').click();
            const pick = page.locator('.quick-input-widget');
            await expect(pick.locator('.monaco-list-row', { hasText: 'src/payments/charge.ts' })).toBeVisible({ timeout: 60_000 });
            await expect(pick.locator('.monaco-list-row', { hasText: 'src/payments/charge.ts' })).toContainText('src/payments/charge.test.ts is green');
            await shot(page, 'IDEA-303-infer-dark.png');
            await page.keyboard.press('Enter');
            await expect.poll(() => zones(dir).find(z => z.id === 'src/payments/charge.ts')?.source).toBe('inferred');
            await expect(note(page, 'frozen').last()).toContainText('src/payments/charge.ts');
            await setAppearance(page, 'light');
            await openSettingsPage(page, 'frozen');
            await expect(manager.locator('[data-zone="src/payments/charge.ts"]')).toContainText('stable: green tests + age');
            await expect(manager).toContainText('green');
            await shot(page, 'IDEA-303-settings-light.png');
            await page.locator('#ingot-settings-cancel').click();
        } finally {
            await restoreAppearance(page, appearance);
        }
    });
});
