import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import { E2E_CONFIG_DIR } from '../src/e2e.consts';

/**
 * IDEA-296 Habits v2: habits are scenario playbooks (.ingot/habits/*.md, global and .cursor/habits). A matching habit
 * is picked automatically (pill + live checklist), allowedTools limits tools, done criteria are checked before the run
 * ends; the agent can pick one with ingot/use_habit; a finished run and a learned pattern can be saved as a habit;
 * the Habits page lists and edits them.
 */
const PAYMENTS = `---
name: Payments bug
when: A bug or failure in the payments flow
keywords: [payments]
errorRegex: PaymentError
steps:
  1. Search the code for the error
  2. Read \`logs/payments.log\`
  3. Run \`node check.js\`
allowedTools: [grep, read_file, run]
doneCriteria:
  - \`node check.js\` passes
  - The root cause is named in the reply
---
PAYMENTS-NOTES-MARKER
`;
const FLAKY = '---\nname: Flaky tests\nwhen: A test passes and fails at random\nkeywords: [flaky]\nsteps:\n  - Rerun the test three times\n---\n';
const GLOBAL_HABIT = '---\nname: Global review\nwhen: Reviewing a pull request\nkeywords: [review]\nsteps:\n  - Read the diff\n---\n';
const CURSOR_HABIT = '---\nname: Cursor deploy\nwhen: Deploying the app\nsteps:\n  - Run the deploy script\n---\n';
const BROKEN = '---\nname: Broken\nwhen: never\n---\n';
const LEARNED = { version: 1, habits: [{ id: 'command-npm-run-lint', kind: 'command', key: 'command:npm run lint', label: 'npm run lint', text: 'Run `npm run lint` in the project root and report the result.', count: 3, examples: ['npm run lint'], enabled: true, status: 'proposed', firstSeen: 1, lastSeen: 2 }] };
const GLOBAL_FILE = path.join(E2E_CONFIG_DIR, 'habits', 'global-review.md');

const SETTINGS_FILE = path.join(E2E_CONFIG_DIR, 'settings.json');
const DISABLED_PREF = 'ingot.habits.playbooks.disabled';

/** A run that stopped half way could leave a habit switched off in the shared e2e user settings. */
const resetDisabledHabits = (): void => {
    if (!fs.existsSync(SETTINGS_FILE)) {
        return;
    }
    try {
        const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) as Record<string, unknown>;
        if (DISABLED_PREF in settings) {
            delete settings[DISABLED_PREF];
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, undefined, 4));
        }
    } catch {
        // Not plain JSON: leave it to the app.
    }
};

const write = (dir: string, file: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
};

const makeProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-habits-v2-')));
    write(dir, 'package.json', JSON.stringify({ name: 'shop', private: true }, undefined, 2));
    write(dir, 'check.js', "console.log('CHECK-OK');\n");
    write(dir, 'logs/payments.log', 'PaymentError: currency missing\n');
    write(dir, 'src/payments/charge.ts', 'export const charge = () => { throw new Error("PaymentError"); };\n');
    write(dir, '.ingot/habits/payments-bug.md', PAYMENTS);
    write(dir, '.ingot/habits/flaky-tests.md', FLAKY);
    write(dir, '.ingot/habits/broken.md', BROKEN);
    write(dir, '.cursor/habits/cursor-deploy.md', CURSOR_HABIT);
    write(dir, '.ingot/habits.json', JSON.stringify(LEARNED, undefined, 2));
    return dir;
};

const tool = (name: string, args: Record<string, unknown>, before = ''): string => `${before}${before ? '\n\n' : ''}<<<TOOL ingot/${name}\n${JSON.stringify(args)}\n>>>END`;
const composer = (page: Page) => page.locator('#ingot-composer-input');
const agentReplies = (page: Page) => page.locator('#ingot-agents .ingot-chat-agent');

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

test.describe('IDEA-296 Habits v2: scenario playbooks', () => {
    test.setTimeout(240_000);
    let dir: string;
    let server: FakeOllama;

    test.beforeEach(async () => {
        resetDisabledHabits();
        dir = makeProject();
        write(path.dirname(GLOBAL_FILE), path.basename(GLOBAL_FILE), GLOBAL_HABIT);
        server = await startFakeOllama((_system, user) => {
            if (user.startsWith('payments checkout fails')) {
                return tool('grep', { pattern: 'PaymentError' }, 'Looking at the payments code.');
            }
            if (user.startsWith('Tool result (ingot/grep)') && user.includes('PaymentError')) {
                return tool('delete', { path: 'check.js' }, 'HABIT-STEP: 1');
            }
            if (user.startsWith('Tool result (ingot/delete)')) {
                return tool('read_file', { path: 'logs/payments.log' });
            }
            if (user.startsWith('Tool result (ingot/read_file)')) {
                return tool('run', { command: 'node check.js' }, 'HABIT-STEP: 2');
            }
            if (user.startsWith('Tool result (ingot/run)') && user.includes('CHECK-OK') && !user.includes('RELEASE')) {
                return 'The check passes.';
            }
            if (user.startsWith('Before you finish, check the done criteria')) {
                return 'HABIT-DONE: 2\nRoot cause: the currency was missing. All done.';
            }
            if (user.startsWith('the release build is broken')) {
                return tool('use_habit', { name: 'Flaky tests' }, 'This looks flaky.');
            }
            if (user.startsWith('Tool result (ingot/use_habit)')) {
                return tool('grep', { pattern: 'retry' });
            }
            if (user.startsWith('Tool result (ingot/grep)')) {
                return tool('run', { command: 'node check.js && echo RELEASE' }, 'HABIT-STEP: 1');
            }
            if (user.startsWith('Tool result (ingot/run)')) {
                return 'The release build passes now.';
            }
            return 'Done.';
        }, { delayMs: 0 });
    });

    test.afterEach(async () => {
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
        fs.rmSync(GLOBAL_FILE, { force: true });
    });

    test('a matching habit is picked: pill, live checklist, allowedTools, done criteria, switch and turn off', async ({ page }) => {
        await openIngot(page, dir);
        const appearance = await currentAppearance(page);
        try {
            await setAppearance(page, 'dark');
            await connectOllama(page, server);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            await dismissNotifications(page);
            await composer(page).fill('payments checkout fails with PaymentError');
            await composer(page).press('Enter');
            await expect(page.locator('#ingot-approval-line')).toHaveText('Run command: node check.js', { timeout: 60_000 });
            await page.locator('#ingot-approval-run').click();
            await expect(agentReplies(page).last()).toContainText('Root cause: the currency was missing. All done.', { timeout: 60_000 });

            const first = server.requests.find(r => r.user.startsWith('payments checkout fails'))!;
            expect(first.system).toContain('Habits (team playbooks');
            for (const name of ['- Payments bug: A bug or failure in the payments flow', '- Flaky tests:', '- Global review:', '- Cursor deploy:']) {
                expect(first.system).toContain(name);
            }
            expect(first.system).not.toContain('- Broken:');
            expect(first.system).toContain('Active habit: Payments bug (.ingot/habits/payments-bug.md)');
            expect(first.system).toContain('only these tools may be called: grep, read_file, run');
            expect(first.system).toContain('PAYMENTS-NOTES-MARKER');
            // allowedTools: the delete was refused and never ran.
            expect(server.requests.find(r => r.user.startsWith('Tool result (ingot/delete)'))?.user).toContain('allows only these tools: grep, read_file, run');
            expect(fs.existsSync(path.join(dir, 'check.js'))).toBe(true);
            // Done criteria were checked before finishing; the passing command ticked the first one.
            const nudge = server.requests.find(r => r.user.startsWith('Before you finish, check the done criteria'))!;
            expect(nudge.user).toContain('2. The root cause is named in the reply');
            expect(nudge.user).not.toContain('1. `node check.js` passes');

            const pill = page.locator('#ingot-habit-pill');
            await expect(pill).toContainText('Using habit: Payments bug');
            await expect(pill).toContainText('3/3');
            await expect(pill).toHaveAttribute('title', /matched automatically: error in prompt, keyword "payments"/);
            const checklist = page.locator('#ingot-habit-checklist');
            await expect(checklist.locator('.ingot-habit-check.done')).toHaveCount(5);
            await expect(page.locator('#ingot-agents')).not.toContainText('HABIT-STEP');
            await expect(page.locator('#ingot-agents')).not.toContainText('HABIT-DONE');
            await shot(page, 'habits-v2-pill-checklist-dark.png');
            await setAppearance(page, 'light');
            await shot(page, 'habits-v2-pill-checklist-light.png');

            await pill.click();
            const menu = page.locator('#ingot-habit-menu');
            await expect(menu.locator('[data-habit-id="project:payments-bug"]')).toHaveAttribute('aria-checked', 'true');
            await expect(menu.locator('[data-habit-id="global:global-review"]')).toContainText('Global');
            await expect(menu.locator('[data-habit-id="cursor:cursor-deploy"]')).toContainText('.cursor');
            await shot(page, 'habits-v2-pill-menu-light.png');
            await page.locator('#ingot-habit-off').click();
            await expect(pill).toHaveText(/Habit off/);
            await expect(checklist).toHaveCount(0);
            await pill.click();
            await menu.locator('[data-habit-id="project:flaky-tests"]').click();
            await expect(pill).toContainText('Using habit: Flaky tests');
            await expect(pill).toContainText('0/1');
        } finally {
            await restoreAppearance(page, appearance);
        }
    });

    test('use_habit, Save as habit, Make it a habit and the Habits page', async ({ page }) => {
        await openIngot(page, dir);
        const appearance = await currentAppearance(page);
        await openSettingsPage(page, 'habits');
        await page.locator('#ingot-habits-enabled').check();
        await page.locator('#ingot-settings-cancel').click();
        try {
            await setAppearance(page, 'dark');
            await connectOllama(page, server);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            await dismissNotifications(page);

            // A learned pattern card offers "Make it a habit".
            const card = page.locator('#ingot-habit-cards .ingot-habit-card');
            await expect(card).toContainText('You often run `npm run lint`.');
            await shot(page, 'habits-v2-learned-card-dark.png');
            await card.locator('[data-target="habit"]').click();
            const draft = page.locator('#ingot-habit-draft');
            await expect(page.locator('#ingot-habit-draft-text')).toHaveValue(/name: Run npm run lint/);
            await expect(page.locator('#ingot-habit-draft-text')).toHaveValue(/`npm run lint` passes/);
            await page.locator('#ingot-habit-draft-save').click();
            await expect(page.locator('#ingot-agents .ingot-habit-note[data-habit-note="project:run-npm-run-lint"]')).toContainText('Run npm run lint → .ingot/habits/run-npm-run-lint.md');
            expect(fs.readFileSync(path.join(dir, '.ingot/habits/run-npm-run-lint.md'), 'utf8')).toContain('Run `npm run lint` and fix what fails');
            await expect(card).toHaveCount(0);

            // The agent picks a habit with ingot/use_habit.
            await composer(page).fill('the release build is broken');
            await composer(page).press('Enter');
            await expect(page.locator('#ingot-approval-line')).toHaveText('Run command: node check.js && echo RELEASE', { timeout: 60_000 });
            await page.locator('#ingot-approval-run').click();
            await expect(agentReplies(page).last()).toContainText('The release build passes now.', { timeout: 60_000 });
            expect(server.requests.find(r => r.user.startsWith('Tool result (ingot/use_habit)'))?.user).toContain('Active habit: Flaky tests');
            await expect(page.locator('#ingot-habit-pill')).toContainText('Using habit: Flaky tests');
            await expect(page.locator('#ingot-habit-pill')).toHaveAttribute('title', /picked by the agent/);

            // Save this run as a habit: drafted from the prompt, steps, files and commands, edited, then saved.
            await page.locator('#ingot-save-habit').click();
            const text = page.locator('#ingot-habit-draft-text');
            await expect(text).toHaveValue(/when: Tasks like: the release build is broken/);
            await expect(text).toHaveValue(/ {2}- Search the code for `retry`\n {2}- Run `node check.js && echo RELEASE`/);
            await expect(text).toHaveValue(/doneCriteria:\n {2}- `node check.js && echo RELEASE` passes/);
            await expect(draft.locator('.ingot-playbook-summary')).toContainText('2 steps');
            await shot(page, 'habits-v2-save-run-dark.png');
            await text.fill((await text.inputValue()).replace(/name: .*/, 'name: Release build broken').replace('steps:\n', 'steps:\n  - Check the CI log\n'));
            await page.locator('#ingot-habit-draft-save').click();
            const runNote = page.locator('#ingot-agents .ingot-habit-note[data-habit-note="project:release-build-broken"]');
            await expect(runNote).toContainText('Release build broken → .ingot/habits/release-build-broken.md');
            const saved = fs.readFileSync(path.join(dir, '.ingot/habits/release-build-broken.md'), 'utf8');
            expect(saved).toContain('name: Release build broken');
            expect(saved).toContain('  - Check the CI log\n  - Search the code for `retry`');
            // The note opens that habit on the Habits page.
            await runNote.locator('.ingot-habit-note-open').click();
            await expect(page.locator('#ingot-playbooks-project [data-habit-id="project:release-build-broken"]')).toHaveClass(/ingot-habit-highlight/);
            await page.locator('#ingot-settings-cancel').click();

            // The Habits page lists playbooks (project, global, .cursor, load errors) and learned patterns.
            await setAppearance(page, 'light');
            await openSettingsPage(page, 'habits');
            const project = page.locator('#ingot-playbooks-project');
            for (const id of ['project:payments-bug', 'project:flaky-tests', 'project:release-build-broken', 'project:run-npm-run-lint']) {
                await expect(project.locator(`[data-habit-id="${id}"]`)).toBeVisible();
            }
            await expect(page.locator('#ingot-playbooks-global [data-habit-id="global:global-review"]')).toContainText('Reviewing a pull request');
            await expect(page.locator('#ingot-playbooks-cursor [data-habit-id="cursor:cursor-deploy"]')).toBeVisible();
            await expect(page.locator('#ingot-playbooks-errors [data-path=".ingot/habits/broken.md"]')).toContainText('"steps" needs at least one step');
            await expect(page.locator('#ingot-habits-manager .ingot-habit-row').first()).toContainText('saved · .ingot/habits/run-npm-run-lint.md');
            await shot(page, 'habits-v2-settings-light.png');

            // On / off is per user.
            const payments = project.locator('[data-habit-id="project:payments-bug"]');
            await payments.getByRole('checkbox', { name: 'Use habit Payments bug' }).uncheck();
            await expect(payments).toHaveClass(/off/);
            await payments.getByRole('checkbox', { name: 'Use habit Payments bug' }).check();
            await expect(payments).not.toHaveClass(/off/);

            // Edit: invalid text cannot be saved; valid text is written.
            await project.locator('[data-habit-id="project:flaky-tests"]').getByRole('button', { name: 'Edit habit Flaky tests' }).click();
            const edit = page.locator('#ingot-playbook-edit-text');
            await edit.fill('---\nname: Flaky tests\nwhen: A test passes and fails at random\n---\n');
            await expect(page.locator('#ingot-playbook-edit')).toContainText('"steps" needs at least one step');
            await expect(page.locator('#ingot-playbook-edit-save')).toBeDisabled();
            await edit.fill(FLAKY.replace('  - Rerun the test three times\n', '  - Rerun the test three times\n  - Quarantine it if it still fails\n'));
            await page.locator('#ingot-playbook-edit-save').click();
            await expect(project.locator('[data-habit-id="project:flaky-tests"]')).toContainText('2 steps');
            expect(fs.readFileSync(path.join(dir, '.ingot/habits/flaky-tests.md'), 'utf8')).toContain('Quarantine it');

            // Add and delete.
            await page.locator('#ingot-playbooks-add-project').click();
            await page.locator('#ingot-playbook-new-text').fill('---\nname: DB migration\nwhen: Changing the database schema\nsteps:\n  - Write the migration\n  - Run it on a copy\n---\n');
            await shot(page, 'habits-v2-settings-add-light.png');
            await page.locator('#ingot-playbook-new-save').click();
            const added = project.locator('[data-habit-id="project:db-migration"]');
            await expect(added).toContainText('2 steps');
            expect(fs.existsSync(path.join(dir, '.ingot/habits/db-migration.md'))).toBe(true);
            await added.getByRole('button', { name: 'Delete habit DB migration' }).click();
            await expect(added).toHaveCount(0);
            await expect.poll(() => fs.existsSync(path.join(dir, '.ingot/habits/db-migration.md'))).toBe(false);
            await page.locator('#ingot-settings-cancel').click();
        } finally {
            if (!await page.locator('#ingot-settings').isVisible()) {
                await openSettingsPage(page, 'habits');
            }
            await page.locator('#ingot-settings-node-habits').click();
            await page.locator('#ingot-habits-enabled').uncheck();
            await restoreAppearance(page, appearance);
        }
    });
});
