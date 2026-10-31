import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';

/**
 * IDEA-304 Doom-Loop Breaker: an agent that keeps "fixing" the same failing check (and saying it passes) is paused
 * after the same error comes back 3 times. The chat shows what was tried and offers a different approach / reset; the
 * failed approach is saved to .ingot/anti-habits.md and Habits ("Saved to Habits") and goes into the next prompt.
 */
const SUM_BROKEN = 'module.exports = (a, b) => a - b;\n';
const SUM_OK = 'module.exports = (a, b) => a + b;\n';
const wrongSum = (n: number): string => `// try ${n}\nmodule.exports = (a, b) => a + b + ${n};\n`;
const CHECK = "const sum = require('./src/sum');\nconst got = sum(1, 2);\nif (got !== 3) {\n    console.error('Error: expected 3 but got ' + got);\n    process.exit(1);\n}\nconsole.log('CHECK-OK');\n";
const ANTI = '.ingot/anti-habits.md';

const write = (dir: string, file: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
};
const read = (dir: string, file: string): string => fs.existsSync(path.join(dir, file)) ? fs.readFileSync(path.join(dir, file), 'utf8') : '';

const makeProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-doom-')));
    write(dir, 'package.json', `${JSON.stringify({ name: 'calc', private: true }, undefined, 2)}\n`);
    write(dir, 'src/sum.js', SUM_BROKEN);
    write(dir, 'check.js', CHECK);
    return dir;
};

const edit = (file: string, body: string): string => `<<<EDIT ${file}\n${body.trimEnd()}\n>>>END`;
const RUN_CHECK = `<<<TOOL ingot/run\n${JSON.stringify({ command: 'node check.js' })}\n>>>END`;
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

test.describe('IDEA-304 Doom-Loop Breaker', () => {
    test.setTimeout(240_000);
    let dir: string;
    let server: FakeOllama;

    test.beforeEach(async () => {
        dir = makeProject();
        let tries = 0;
        server = await startFakeOllama((_system, user) => {
            if (user.startsWith('make the check pass') || user.startsWith('try the sum fix again')) {
                tries = 1;
                return `Adjusting the sum.\n\n${edit('src/sum.js', wrongSum(tries))}\n\n${RUN_CHECK}`;
            }
            if (user.startsWith('Stop repeating the last approach')) {
                return `I think the operator itself is wrong, not the offset.\n\n${edit('src/sum.js', SUM_OK)}`;
            }
            if (user.startsWith('Tool result (ingot/run)')) {
                tries++;
                return `Fixed it, the check passes now.\n\n${edit('src/sum.js', wrongSum(tries))}\n\n${RUN_CHECK}`;
            }
            return 'OK.';
        }, { delayMs: 0 });
    });

    test.afterEach(async () => {
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('the same error 3 times pauses the run, saves an anti-habit, and offers a different approach or reset', async ({ page }) => {
        await openIngot(page, dir);
        const appearance = await currentAppearance(page);
        try {
            await setAppearance(page, 'dark');
            await connectOllama(page, server);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            await dismissNotifications(page);

            await send(page, 'make the check pass: node check.js');
            await expect(page.locator('#ingot-approval-line')).toHaveText('Run command: node check.js', { timeout: 60_000 });
            await page.locator('#ingot-approval-always').click();

            // Third time the same error: paused with a summary of what was tried.
            const card = page.locator('#ingot-doom');
            await expect(card).toBeVisible({ timeout: 90_000 });
            await expect(card).toContainText('Paused · Same error again');
            await expect(card).toContainText('The same error came back 3 times: "expected n but got n".');
            await expect(card.locator('.ingot-doom-tried li')).toContainText(['Edited src/sum.js', 'node check.js → "expected n but got n"']);
            await expect(card.locator('button')).toHaveText(['Try a different approach', 'Reset', 'Keep going', 'Stop here']);
            // The third failing result pauses the run before it goes back to the model.
            expect(server.requests.filter(r => r.user.startsWith('Tool result (ingot/run)'))).toHaveLength(2);
            await expect(page.locator('#ingot-agents')).toContainText('Paused: The same error came back 3 times');
            // The failed approach is an anti-habit, in .ingot/ and in Habits.
            await expect(note(page, 'habit').last()).toContainText('Saved to Habits');
            await expect(note(page, 'habit').last()).toContainText('Editing src/sum.js then node check.js while "expected n but got n" kept failing');
            await expect.poll(() => read(dir, ANTI)).toContain("- Don't: Editing src/sum.js then node check.js while \"expected n but got n\" kept failing");
            await expect.poll(() => read(dir, '.ingot/habits.json')).toContain('"kind": "anti"');
            await shot(page, 'IDEA-304-paused-dark.png');
            await setAppearance(page, 'light');
            await shot(page, 'IDEA-304-paused-light.png');

            // Try a different approach: the agent is told what failed, and the anti-habit is in its prompt.
            await page.locator('#ingot-doom-different').click();
            await expect(card).toHaveCount(0);
            await expect(agentReplies(page).last()).toContainText('I think the operator itself is wrong', { timeout: 60_000 });
            const nudge = server.requests.find(r => r.user.startsWith('Stop repeating the last approach'))!;
            expect(nudge.user).toContain('- node check.js → "expected n but got n"');
            expect(nudge.system).toContain("Don't do this here (approaches that already failed in this project, .ingot/anti-habits.md):");
            await expect.poll(() => read(dir, 'src/sum.js'), { timeout: 15_000 }).toBe(SUM_OK);
            // With review auto-accept on, the change is already kept.
            if (await page.locator('#ingot-changes-accept-all').isVisible()) {
                await page.locator('#ingot-changes-accept-all').click();
            }
            await expect(page.locator('#ingot-agents')).toContainText('Review finished: 1 of 1 change(s) kept.');

            // A second loop: Reset puts the files back to before that message.
            await send(page, 'try the sum fix again');
            await expect(card).toBeVisible({ timeout: 90_000 });
            await shot(page, 'IDEA-304-paused-again-light.png');
            await page.locator('#ingot-doom-reset').click();
            await expect(card).toHaveCount(0);
            await expect(page.locator('#ingot-agents')).toContainText('Reset: files are back to before "try the sum fix again".');
            await expect.poll(() => read(dir, 'src/sum.js'), { timeout: 15_000 }).toBe(SUM_OK);
            await setAppearance(page, 'dark');
            await shot(page, 'IDEA-304-reset-dark.png');
        } finally {
            await restoreAppearance(page, appearance);
        }
    });
});
