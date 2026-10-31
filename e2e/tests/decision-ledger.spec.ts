import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot, runCommand } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';

/**
 * IDEA-302 Decision Ledger: the agent proposes `DECISION:` lines, the user confirms, Ingot locks them in
 * .ingot/decisions.md with a silver "Locked in Decisions" note; a decision confirmed often enough becomes a rule and a
 * habit ("Saved to Habits"). An edit that contradicts a locked decision asks in the chat first; Keep sends the agent
 * back to find another way. Settings › Decisions and "Lock a Decision…" lock / unlock by hand.
 */
const PACKAGE = `${JSON.stringify({ name: 'shop', private: true, scripts: { test: 'node -e "process.exit(0)"' } }, undefined, 2)}\n`;
const withLint = (command: string): string => `${JSON.stringify({ name: 'shop', private: true, scripts: { test: 'node -e "process.exit(0)"', lint: command } }, undefined, 2)}\n`;
const NPM_LINT = withLint('npm exec eslint .');
const PNPM_LINT = withLint('pnpm exec eslint .');
/** Confirmed twice before and unlocked since: one more "yes" locks it again and makes it a habit. */
const LEDGER = '# Decisions\n\n- [ ] Use pnpm, not npm <!-- id=use-pnpm-not-npm; confirmed=2; avoid=npm; at=2026-10-01 -->\n';
const DECISIONS = '.ingot/decisions.md';
const RULE = '.ingot/rules/decision-use-pnpm-not-npm.md';

const write = (dir: string, file: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
};
const read = (dir: string, file: string): string => fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), 'utf8') : '';

const makeProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-decisions-')));
    write(dir, 'package.json', PACKAGE);
    write(dir, DECISIONS, LEDGER);
    return dir;
};

const edit = (file: string, body: string): string => `<<<EDIT ${file}\n${body.trimEnd()}\n>>>END`;
const composer = (page: Page) => page.locator('#ingot-composer-input');
const agentReplies = (page: Page) => page.locator('#ingot-agents .ingot-chat-agent');
const note = (page: Page, kind: string) => page.locator(`#ingot-agents .ingot-habit-note[data-note-kind="${kind}"]`);

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

test.describe('IDEA-302 Decision Ledger', () => {
    test.setTimeout(240_000);
    let dir: string;
    let server: FakeOllama;

    test.beforeEach(async () => {
        dir = makeProject();
        server = await startFakeOllama((_system, user) => {
            if (user.startsWith('which package manager')) {
                return 'This repo has no lockfile yet. I suggest pnpm: it is faster and strict about phantom dependencies.\n\nDECISION: Use pnpm, not npm';
            }
            if (user.startsWith('yes, go with that')) {
                return 'Done: I will use pnpm from now on.';
            }
            if (user.startsWith('add a lint script')) {
                return `Adding a lint script.\n\n${edit('package.json', NPM_LINT)}`;
            }
            if (user.startsWith('The user kept the locked decision')) {
                return `Right, pnpm it is.\n\n${edit('package.json', PNPM_LINT)}`;
            }
            return 'OK.';
        }, { delayMs: 0 });
    });

    test.afterEach(async () => {
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('confirming locks the decision, promotes it to a habit, and a contradicting edit asks first', async ({ page }) => {
        await openIngot(page, dir);
        const appearance = await currentAppearance(page);
        try {
            await setAppearance(page, 'dark');
            await connectOllama(page, server);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            await dismissNotifications(page);

            // The agent proposes; the user confirms; the decision is locked (third confirmation: it becomes a habit).
            await send(page, 'which package manager should we use?');
            await expect(agentReplies(page).last()).toContainText('DECISION: Use pnpm, not npm', { timeout: 60_000 });
            expect(server.requests[server.requests.length - 1].system).toContain('DECISION: <one short sentence');
            await send(page, 'yes, go with that');
            await expect(agentReplies(page).last()).toContainText('I will use pnpm from now on.', { timeout: 60_000 });
            await expect(note(page, 'decision').first()).toContainText('Locked in Decisions');
            await expect(note(page, 'decision').first()).toContainText('Use pnpm, not npm');
            await expect(note(page, 'decision').first().locator('.ingot-habit-note-undo')).toHaveText('Unlock');
            await expect(note(page, 'habit').first()).toContainText('Saved to Habits');
            await expect(note(page, 'habit').first()).toContainText(RULE);
            // The run waited for the ledger: the locked decision is already in this turn's system prompt.
            const confirmed = server.requests.find(r => r.user.startsWith('yes, go with that'))!;
            expect(confirmed.system).toContain('Locked decisions (.ingot/decisions.md)');
            expect(confirmed.system).toContain('- Use pnpm, not npm');
            expect(read(dir, DECISIONS)).toMatch(/- \[x\] Use pnpm, not npm <!-- id=use-pnpm-not-npm; confirmed=3; avoid=npm; at=2026-10-01; habit=\.ingot\/rules\/decision-use-pnpm-not-npm\.md -->/);
            expect(read(dir, RULE)).toContain('alwaysApply: true');
            await expect.poll(() => read(dir, '.ingot/habits.json')).toContain('"key": "decision:use pnpm not npm"');
            await shot(page, 'IDEA-302-locked-note-dark.png');

            // An edit that adds `npm` asks before it lands; Keep sends the agent back, and its pnpm edit goes through.
            await send(page, 'add a lint script');
            const ask = page.locator('#ingot-ask');
            await expect(page.locator('#ingot-ask-question')).toHaveText(
                'This contradicts a locked decision: "Use pnpm, not npm" (package.json uses "npm"). Go ahead anyway?', { timeout: 60_000 });
            await expect(ask.locator('.ingot-ask-option')).toHaveText(['Keep the decision', 'Go ahead this time', 'Unlock the decision']);
            await shot(page, 'IDEA-302-conflict-ask-dark.png');
            await setAppearance(page, 'light');
            await shot(page, 'IDEA-302-conflict-ask-light.png');
            await ask.locator('.ingot-ask-option', { hasText: 'Keep the decision' }).click();
            await expect(agentReplies(page).last()).toContainText('Right, pnpm it is.', { timeout: 60_000 });
            await expect.poll(() => read(dir, 'package.json')).toContain('pnpm exec eslint .');
            expect(read(dir, 'package.json')).not.toContain('"npm exec');
            expect(server.requests.find(r => r.user.startsWith('The user kept the locked decision'))?.user).toContain('"Use pnpm, not npm". Skipped: package.json.');
            // The guard's own answer is not read as confirming anything.
            expect(read(dir, DECISIONS)).toContain('confirmed=3');
            await note(page, 'decision').first().scrollIntoViewIfNeeded();
            await shot(page, 'IDEA-302-locked-note-light.png');

            // "Lock a Decision…" from Find Action shows the note in the chat.
            await runCommand(page, 'Lock a Decision…');
            const input = page.locator('.quick-input-widget input');
            await expect(page.locator('.quick-input-widget')).toContainText('Lock a Decision…');
            await input.fill('Never use moment.js');
            await input.press('Enter');
            await expect(note(page, 'decision').last()).toContainText('Never use moment.js');
            await expect.poll(() => read(dir, DECISIONS)).toMatch(/- \[x\] Never use moment\.js <!-- id=[^;]+; confirmed=1; avoid=moment\.js;/);

            // Settings › Decisions: the ledger with lock / unlock, add and delete.
            await openSettingsPage(page, 'decisions');
            const manager = page.locator('#ingot-decisions-manager');
            await expect(manager.locator('[data-decision="use-pnpm-not-npm"]')).toContainText(`habit · ${RULE}`);
            await page.locator('#ingot-decision-input').fill('Use Vitest, not Jest');
            await page.locator('#ingot-decision-add').click();
            const vitest = manager.locator('[data-decision="use-vitest-not-jest"]');
            await expect(vitest).toContainText('Use Vitest, not Jest');
            await expect.poll(() => read(dir, DECISIONS)).toContain('- [x] Use Vitest, not Jest');
            await shot(page, 'IDEA-302-settings-light.png');
            await vitest.getByRole('checkbox', { name: 'Lock Use Vitest, not Jest' }).uncheck();
            await expect(vitest).toHaveClass(/off/);
            await expect.poll(() => read(dir, DECISIONS)).toContain('- [ ] Use Vitest, not Jest');
            await page.locator('#ingot-settings-cancel').click();
            await setAppearance(page, 'dark');
            await openSettingsPage(page, 'decisions');
            await expect(vitest).toHaveClass(/off/);
            await shot(page, 'IDEA-302-settings-dark.png');
            await vitest.getByRole('button', { name: 'Delete decision Use Vitest, not Jest' }).click();
            await expect(vitest).toHaveCount(0);
            await expect.poll(() => read(dir, DECISIONS)).not.toContain('Vitest');
            await page.locator('#ingot-settings-cancel').click();

            // Unlock from the chat note.
            await note(page, 'decision').first().locator('.ingot-habit-note-undo').click();
            await expect(note(page, 'decision').first()).toHaveClass(/undone/);
            await expect.poll(() => read(dir, DECISIONS)).toContain('- [ ] Use pnpm, not npm');
        } finally {
            await restoreAppearance(page, appearance);
        }
    });
});
