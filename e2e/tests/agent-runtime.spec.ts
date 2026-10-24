import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { FIXTURE_WORKSPACE } from '../src/e2e.consts';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

const MATH = path.join(FIXTURE_WORKSPACE, 'src', 'math.ts');
const STRINGS = path.join(FIXTURE_WORKSPACE, 'src', 'strings.ts');
const ORIGINAL_MATH = fs.readFileSync(MATH, 'utf8');
const SUBTRACT = 'export function subtract(a: number, b: number): number {\n    return a - b;\n}\n';
const NEW_MATH = `${ORIGINAL_MATH}\n${SUBTRACT}`;
const STRINGS_CONTENT = "export const shout = (text: string): string => text.toUpperCase();\n";

const editReply = [
    'PLAN:',
    '- Read src/math.ts',
    '- Add subtract',
    '',
    'Adding a subtract function next to add.',
    '<<<EDIT src/math.ts',
    NEW_MATH.trimEnd(),
    '>>>END',
    'Done: subtract is exported from src/math.ts.'
].join('\n');

const twoFileReply = [
    'Updating two files.',
    '<<<EDIT src/math.ts', NEW_MATH.trimEnd(), '>>>END',
    '<<<EDIT src/strings.ts', STRINGS_CONTENT.trimEnd(), '>>>END'
].join('\n');

const ask = async (page: Page, prompt: string): Promise<void> => {
    await page.locator('#ingot-agents-new').click();
    await page.locator('#ingot-composer-model').selectOption('ollama-local');
    await page.locator('#ingot-composer-input').fill(prompt);
    await page.locator('#ingot-composer-input').press('Enter');
};

test.describe('IDEA-27-29 agent runtime: streaming answers and edits through the inline review', () => {
    let server: FakeOllama;
    let replyText = editReply;

    test.beforeEach(async () => { server = await startFakeOllama(() => replyText); });
    test.afterEach(async () => {
        await server.close();
        execFileSync('git', ['checkout', '--', MATH], { cwd: FIXTURE_WORKSPACE });
        fs.rmSync(STRINGS, { force: true });
    });

    test('streams the answer, proposes an edit inline and Ctrl+Y saves it to disk', async ({ page }) => {
        replyText = editReply;
        await openIngot(page);
        await connectOllama(page, server);
        await ask(page, 'Add subtract to @src/math.ts');

        const agentMsg = page.locator('#ingot-agents .ingot-chat-agent').last();
        await expect(agentMsg).toContainText('Adding a subtract function');
        await expect(page.locator('#ingot-agents .ingot-chat-plan')).toContainText('Add subtract');
        // Context and protocol went to the model: the mentioned file and the edit-block format.
        const request = server.requests.at(-1)!;
        expect(request.system).toContain('<<<EDIT');
        expect(request.system).toContain('File: src/math.ts');

        const bar = page.locator('.ingot-agent-edit-bar');
        await expect(bar).toBeVisible({ timeout: 15_000 });
        await expect(bar).toContainText('+4');
        await expect(page.locator('.ingot-diff-added-line').first()).toBeVisible();
        await expect(agentMsg).not.toContainText('<<<EDIT');

        await page.keyboard.press('Control+y');
        await expect(bar).toBeHidden();
        await expect.poll(() => fs.readFileSync(MATH, 'utf8')).toContain('export function subtract');
        await expect(page.locator('#ingot-agents')).toContainText('Review finished: 1 of 1 change(s) kept.');
    });

    test('reviews several files one by one: Ctrl+N rejects, Ctrl+Y creates the new file', async ({ page }) => {
        replyText = twoFileReply;
        await openIngot(page);
        await connectOllama(page, server);
        await ask(page, 'Add subtract and a strings helper');

        const bar = page.locator('.ingot-agent-edit-bar');
        await expect(bar.locator('.ingot-agent-edit-file')).toHaveText('math.ts', { timeout: 15_000 });
        await page.keyboard.press('Control+n');
        await expect(bar.locator('.ingot-agent-edit-file')).toHaveText('strings.ts');
        expect(fs.readFileSync(MATH, 'utf8')).toBe(ORIGINAL_MATH);
        await page.keyboard.press('Control+y');
        await expect(bar).toBeHidden();
        await expect.poll(() => fs.existsSync(STRINGS) && fs.readFileSync(STRINGS, 'utf8')).toBe(STRINGS_CONTENT);
        await expect(page.locator('#ingot-agents')).toContainText('Review finished: 1 of 2 change(s) kept.');
    });

    test('Stop cancels a streaming answer', async ({ page }) => {
        replyText = `Thinking out loud. ${'This is a very long answer. '.repeat(120)}`;
        await openIngot(page);
        await connectOllama(page, server);
        await dismissNotifications(page);
        await ask(page, 'Explain everything');

        await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('Thinking out loud');
        await expect(page.locator('#ingot-composer-stop')).toBeVisible();
        // Escape in the composer stops the agent (same as the Stop button).
        await page.locator('#ingot-composer-input').press('Escape');
        await expect(page.locator('#ingot-composer-send')).toBeVisible();
        const stopped = await page.locator('#ingot-agents .ingot-chat-agent').last().innerText();
        expect(stopped.length).toBeLessThan(replyText.length);
    });
});
