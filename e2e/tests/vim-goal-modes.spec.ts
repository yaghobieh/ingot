import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilHidden, actUntilVisible, dismissNotifications, openIngot, runCommand } from '../src/app.utils';
import { setAppearance, shot, tokenColor } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { COMPOSER, composerPlainText } from '../src/composer.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/**
 * IDEA-286: Vim keys in code editors (status bar mode, :w and :q, composer and Ingot shortcuts untouched).
 * IDEA-292: /goal keeps taking turns until the self-check passes (banner, Stop), and "Use as mode" pins a
 * skill or command into the chat's system prompt (mode pill).
 */
const write = (dir: string, file: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
};

const makeProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-vim-goal-')));
    write(dir, 'src/notes.ts', 'export const notes = 1;\n');
    write(dir, '.ingot/skills/reviewer/SKILL.md', '---\nname: reviewer\ndescription: Strict code review\n---\nAnswer like a strict reviewer. MODE-REVIEWER-MARKER\n');
    write(dir, '.ingot/commands/terse.md', '---\ndescription: Short answers\n---\nAnswer in one line. MODE-TERSE-MARKER\n');
    return dir;
};

const vimStatus = (page: Page) => page.locator('#status-bar-ingot-vim-mode');
const editorLines = (page: Page) => page.locator('#theia-main-content-panel .monaco-editor .view-lines').first();
const editorTab = (page: Page, label: string) => page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: label });
const banner = (page: Page) => page.locator('#ingot-goal-banner');
const quickInput = (page: Page) => page.locator('.quick-input-widget .quick-input-box input');
const quickOptions = (page: Page) => page.locator('.quick-input-widget .monaco-list-row');

const openFile = async (page: Page, name: string): Promise<void> => {
    await actUntilVisible(() => page.keyboard.press('Control+Shift+N'), quickInput(page));
    await page.keyboard.type(name);
    await quickOptions(page).filter({ hasText: name }).first().click();
    await expect(editorTab(page, name)).toBeVisible();
};

const startChat = async (page: Page, server: FakeOllama): Promise<void> => {
    await connectOllama(page, server);
    await page.locator('#ingot-agents-new').click();
    await pickModel(page, 'ollama-local');
};

const send = async (page: Page, text: string): Promise<void> => {
    await page.locator(COMPOSER).focus();
    await page.keyboard.type(text);
    await page.keyboard.press('Enter');
};

test.describe('IDEA-286 / IDEA-292 Vim mode, /goal and custom modes', () => {
    test.setTimeout(150_000);
    let dir = '';
    let server: FakeOllama | undefined;

    test.afterEach(async () => {
        await server?.close();
        server = undefined;
        if (dir) {
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });

    test('Vim keys: modes in the status bar, :w saves, :q closes, composer and shortcuts keep working', async ({ page }) => {
        dir = makeProject();
        await openIngot(page, dir);
        await setAppearance(page, 'light');
        await dismissNotifications(page);
        await openFile(page, 'notes.ts');
        await expect(vimStatus(page)).toHaveCount(0);

        // Ctrl+Alt+Shift+V (Ingot keymap) turns Vim keys on.
        await editorLines(page).click();
        await actUntilVisible(() => page.keyboard.press('Control+Alt+Shift+V'), vimStatus(page));
        await expect(vimStatus(page)).toHaveText('NORMAL');

        // Normal: `x` deletes a character instead of typing it. Insert and Visual show in the status bar.
        await editorLines(page).click();
        await page.keyboard.press('g');
        await page.keyboard.press('g');
        await page.keyboard.press('0');
        await page.keyboard.press('i');
        await expect(vimStatus(page)).toHaveText('INSERT');
        expect(await vimStatus(page).evaluate(el => getComputedStyle(el).color)).toBe(await tokenColor(page, '--ingot-success'));
        await page.keyboard.type('// vim ');
        await shot(page, 'vim-insert-light.png');
        await page.keyboard.press('Escape');
        await expect(vimStatus(page)).toHaveText('NORMAL');
        await page.keyboard.press('v');
        await expect(vimStatus(page)).toHaveText('VISUAL');
        await page.keyboard.press('Escape');
        await expect(vimStatus(page)).toHaveText('NORMAL');

        // :w saves through Ingot.
        await page.keyboard.type(':');
        const cmdline = page.locator('.ingot-vim-cmdline input');
        await expect(cmdline).toBeVisible();
        await shot(page, 'vim-cmdline-light.png');
        await page.keyboard.type('w');
        await page.keyboard.press('Enter');
        await expect.poll(() => fs.readFileSync(path.join(dir, 'src/notes.ts'), 'utf8')).toContain('// vim export const notes');

        // The agent composer keeps normal typing: `i`, `j` and `k` are letters there, not Vim keys.
        await page.locator(COMPOSER).click();
        await page.keyboard.type('ijk hello');
        await expect.poll(() => composerPlainText(page)).toBe('ijk hello');
        await expect(vimStatus(page)).toHaveText('NORMAL');
        await page.keyboard.press('Control+A');
        await page.keyboard.press('Backspace');

        // Ingot shortcuts still run from a Vim editor (Go to File).
        await editorLines(page).click();
        await actUntilVisible(() => page.keyboard.press('Control+Shift+N'), quickInput(page));
        await actUntilHidden(() => page.keyboard.press('Escape'), quickInput(page));

        // :q closes the editor.
        await editorLines(page).click();
        await page.keyboard.type(':q');
        await page.keyboard.press('Enter');
        await expect(editorTab(page, 'notes.ts')).toHaveCount(0);
        await expect(vimStatus(page)).toHaveCount(0);

        // Dark theme: a reopened file gets Vim keys again, colored from the dark tokens.
        await setAppearance(page, 'dark');
        await openFile(page, 'notes.ts');
        await expect(vimStatus(page)).toHaveText('NORMAL');
        expect(await vimStatus(page).evaluate(el => getComputedStyle(el).color)).toBe(await tokenColor(page, '--ingot-primary'));
        await shot(page, 'vim-normal-dark.png');

        // Toggle off from Find Action: the open editor drops Vim keys and the status bar item goes away.
        await runCommand(page, 'Toggle Vim Mode');
        await expect(vimStatus(page)).toHaveCount(0);
        await expect(page.locator('#theia-main-content-panel [data-ingot-vim]')).toHaveCount(0);
        await editorLines(page).click();
        await page.keyboard.type('zqz');
        await page.keyboard.press('ControlOrMeta+s');
        await expect.poll(() => fs.readFileSync(path.join(dir, 'src/notes.ts'), 'utf8')).toContain('zqz');
    });

    test('/goal keeps working until the self-check passes, then Stop ends a goal', async ({ page }) => {
        dir = makeProject();
        // A slow, never-done reply so Stop lands while the goal is still running.
        const neverDone = `${'Still working. '.repeat(20)}\nGOAL CHECK:\n- [ ] never done\nGOAL: CONTINUE`;
        server = await startFakeOllama((_system, user) => {
            if (user.startsWith('Goal: Keep going') || (user.startsWith('Goal not done yet.') && user.includes('never done'))) {
                return neverDone;
            }
            if (user.startsWith('Goal not done yet.')) {
                return 'The total adds up and the notes are written.\nGOAL CHECK:\n- [x] cart total adds up (checked the code)\n- [x] notes written\nGOAL: DONE';
            }
            return 'Looked at the cart.\nGOAL CHECK:\n- [x] cart total adds up (checked the code)\n- [ ] notes written\nGOAL: CONTINUE';
        }, { delayMs: 30, chunkSize: 6 });
        await openIngot(page, dir);
        await setAppearance(page, 'dark');
        await dismissNotifications(page);
        await startChat(page, server);
        const before = server.requests.length;

        // The `/` menu offers /goal; picking it fills in the command.
        await page.locator(COMPOSER).focus();
        await page.keyboard.type('/go');
        await page.locator('#ingot-slash-builtin-goal').click();
        await expect.poll(() => composerPlainText(page)).toBe('/goal');
        await page.keyboard.type('Make the cart total add up. Done when: cart total adds up; notes written');
        await page.keyboard.press('Enter');

        await expect(banner(page)).toBeVisible();
        await expect(page.locator('#ingot-goal-stop')).toBeVisible();
        await expect(banner(page)).toContainText('Make the cart total add up');
        await shot(page, 'goal-running-dark.png');
        await expect(page.locator('#ingot-goal-state')).toHaveText('Done', { timeout: 30_000 });
        await expect(page.locator('#ingot-goal-meta')).toContainText('2/2 criteria');
        await expect(page.locator('#ingot-goal-meta')).toContainText('Iteration 2/');
        await expect(page.locator('#ingot-goal-stop')).toHaveCount(0);
        await expect(page.locator('.ingot-agents-chat')).toContainText('Goal reached');
        const turns = server.requests.slice(before);
        expect(turns).toHaveLength(2);
        expect(turns[0].system).toContain('GOAL MODE. Objective: Make the cart total add up');
        expect(turns[1].user).toContain('Goal not done yet.');
        expect(turns[1].user).toContain('- [ ] notes written');
        await shot(page, 'goal-done-dark.png');
        await setAppearance(page, 'light');
        await shot(page, 'goal-done-light.png');

        // A goal that never passes: Stop ends it and no more turns are sent.
        await send(page, '/goal Keep going');
        await expect(page.locator('#ingot-goal-stop')).toBeVisible();
        await expect.poll(() => server!.requests.length, { timeout: 20_000 }).toBeGreaterThanOrEqual(before + 4);
        await page.locator('#ingot-goal-stop').click();
        await expect(page.locator('#ingot-goal-state')).toHaveText('Stopped');
        await expect(page.locator('#ingot-composer-stop')).toHaveCount(0);
        const sent = server.requests.length;
        await page.waitForTimeout(1_500);
        expect(server.requests.length).toBe(sent);
        await shot(page, 'goal-stopped-dark.png');
        await page.locator('#ingot-goal-dismiss').click();
        await expect(banner(page)).toHaveCount(0);
    });

    test('Use as mode pins a skill or command into the chat, shown as a mode pill', async ({ page }) => {
        dir = makeProject();
        server = await startFakeOllama(() => 'Done.', { delayMs: 0 });
        await openIngot(page, dir);
        await setAppearance(page, 'light');
        await dismissNotifications(page);
        await startChat(page, server);
        const before = server.requests.length;

        await page.locator(COMPOSER).focus();
        await page.keyboard.type('/');
        await expect(page.locator('#ingot-slash-item-reviewer')).toBeVisible();
        await page.locator('#ingot-slash-mode-reviewer').click();
        const pill = page.locator('#ingot-custom-mode-pill');
        await expect(pill).toContainText('reviewer');
        await expect.poll(() => composerPlainText(page)).toBe('');
        await shot(page, 'mode-pill-light.png');

        await send(page, 'hello');
        await expect.poll(() => server!.requests.at(-1)?.system ?? '').toContain('MODE-REVIEWER-MARKER');
        expect(server.requests.at(-1)?.system).toContain('Custom mode: skill "reviewer"');
        await expect(page.locator('#ingot-composer-stop')).toHaveCount(0);
        await send(page, 'and again');
        await expect.poll(() => server!.requests.length).toBe(before + 2);
        expect(server.requests[before + 1].system).toContain('MODE-REVIEWER-MARKER');
        await expect(page.locator('#ingot-composer-stop')).toHaveCount(0);

        // Find Action switches the pinned mode to a command.
        await runCommand(page, 'Use Command or Skill as Mode');
        await quickOptions(page).filter({ hasText: '/terse' }).first().click();
        await expect(pill).toContainText('/terse');

        // Clearing the pill drops the instructions from the next request.
        await page.locator('#ingot-custom-mode-clear').click();
        await expect(pill).toHaveCount(0);
        await send(page, 'plain now');
        await expect.poll(() => server!.requests.length).toBe(before + 3);
        expect(server.requests[before + 2].system).not.toContain('MODE-TERSE-MARKER');
        expect(server.requests[before + 2].system).not.toContain('MODE-REVIEWER-MARKER');
    });
});
