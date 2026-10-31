import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import { SYSTEM_HOOKS_DIR } from '../src/e2e.consts';

/**
 * IDEA-287: the rest of Cursor's hook events from hooks.json: sessionStart (context + env), beforeSubmitPrompt (block),
 * preToolUse (updated_input), postToolUse (additional_context), stop (followup_message with loop_limit),
 * afterAgentResponse, and system-wide (enterprise) hooks that run before the project's.
 */
const LOGGER = `const fs = require('fs');
const path = require('path');
let s = '';
process.stdin.on('data', d => { s += d; }).on('end', () => {
    const input = JSON.parse(s || '{}');
    const event = input.hook_event_name;
    const level = process.argv[2] || 'project';
    fs.appendFileSync(path.join(process.env.CURSOR_PROJECT_DIR, 'hooks.log'), JSON.stringify({ event, level, session: process.env.HOOK_SESSION || null, input }) + '\\n');
    if (level !== 'project') { process.stdout.write('{}'); return; }
    const out = {
        sessionStart: { additional_context: 'SESSION-CONTEXT-MARKER', env: { HOOK_SESSION: 'from-session' } },
        beforeSubmitPrompt: /SECRET-KEY/.test(input.prompt || '') ? { continue: false, user_message: 'Remove the key first' } : { continue: true },
        preToolUse: { permission: 'allow', updated_input: { path: 'b.txt' } },
        postToolUse: { additional_context: 'POST-TOOL-MARKER' },
        stop: input.loop_count === 0 ? { followup_message: 'FOLLOWUP-MARKER please' } : {}
    }[event] || {};
    process.stdout.write(JSON.stringify(out));
});
`;

const hook = (extra: object = {}): object => ({ command: 'node .ingot/hooks/log.js', timeout: 10, ...extra });

const makeProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-hook-events-')));
    fs.mkdirSync(path.join(dir, '.ingot', 'hooks'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.ingot', 'hooks', 'log.js'), LOGGER);
    fs.writeFileSync(path.join(dir, 'a.txt'), 'A-FILE-MARKER\n');
    fs.writeFileSync(path.join(dir, 'b.txt'), 'B-FILE-MARKER\n');
    fs.writeFileSync(path.join(dir, '.ingot', 'hooks.json'), JSON.stringify({
        version: 1,
        hooks: {
            sessionStart: [hook()], beforeSubmitPrompt: [hook()], preToolUse: [hook({ matcher: 'Read' })], postToolUse: [hook()],
            stop: [hook({ loop_limit: 1 })], afterAgentResponse: [hook()]
        }
    }, undefined, 2));
    fs.mkdirSync(SYSTEM_HOOKS_DIR, { recursive: true });
    fs.writeFileSync(path.join(SYSTEM_HOOKS_DIR, 'hooks.json'), JSON.stringify({
        version: 1, hooks: { afterAgentResponse: [{ command: `node ${JSON.stringify(path.join(dir, '.ingot', 'hooks', 'log.js'))} enterprise`, timeout: 10 }] }
    }));
    return dir;
};

interface LogLine { event: string; level: string; session: string | null; input: Record<string, unknown> }
const readLog = (dir: string): LogLine[] => {
    const file = path.join(dir, 'hooks.log');
    return fs.existsSync(file) ? fs.readFileSync(file, 'utf8').trim().split('\n').filter(Boolean).map(line => JSON.parse(line) as LogLine) : [];
};

const composer = (page: Page) => page.locator('#ingot-composer-input');
const lastAnswer = (page: Page) => page.locator('#ingot-agents .ingot-chat-agent .ingot-md').last();

test.describe('IDEA-287 every Cursor hook event', () => {
    test.setTimeout(180_000);
    let dir = '';
    let server: FakeOllama;

    test.beforeEach(async () => {
        dir = makeProject();
        server = await startFakeOllama((_system, user) => {
            if (user.includes('POST-TOOL-MARKER') || user.startsWith('Tool result (ingot/read_file)')) {
                return 'All read.';
            }
            if (user.includes('FOLLOWUP-MARKER')) {
                return 'Follow-up done.';
            }
            if (user.includes('read the notes')) {
                return '<<<TOOL ingot/read_file\n{"path": "a.txt"}\n>>>END';
            }
            return 'Done.';
        }, { delayMs: 0 });
    });

    test.afterEach(async () => {
        await server.close();
        fs.rmSync(path.join(SYSTEM_HOOKS_DIR, 'hooks.json'), { force: true });
        fs.rmSync(dir, { recursive: true, force: true });
    });

    for (const scheme of ['light', 'dark'] as const) {
        test(`sessionStart, beforeSubmitPrompt, preToolUse, postToolUse, stop follow-up and enterprise hooks (${scheme})`, async ({ page }) => {
            await openIngot(page, dir);
            await setAppearance(page, scheme);
            await connectOllama(page, server);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            await dismissNotifications(page);

            // beforeSubmitPrompt: the prompt never reaches the model.
            await composer(page).fill('deploy with SECRET-KEY abc123');
            await composer(page).press('Enter');
            await expect(page.locator('#ingot-agents')).toContainText('Remove the key first', { timeout: 30_000 });
            expect(server.requests.some(r => r.users.some(u => u.includes('SECRET-KEY')))).toBe(false);
            await shot(page, `hook-events-prompt-blocked-${scheme}.png`);

            // preToolUse rewrites the path; postToolUse adds context; stop sends one follow-up (loop_limit 1).
            await composer(page).fill('read the notes');
            await composer(page).press('Enter');
            await expect(page.locator('#ingot-agents .ingot-chat-user', { hasText: 'FOLLOWUP-MARKER' })).toBeVisible({ timeout: 60_000 });
            await expect(lastAnswer(page)).toHaveText('Follow-up done.', { timeout: 60_000 });
            await shot(page, `hook-events-followup-${scheme}.png`);

            const toolTurn = server.requests.find(r => r.users.some(u => u.startsWith('Tool result (ingot/read_file)')));
            expect(toolTurn?.users.join('\n')).toContain('B-FILE-MARKER');
            expect(toolTurn?.users.join('\n')).not.toContain('A-FILE-MARKER');
            expect(toolTurn?.users.join('\n')).toContain('POST-TOOL-MARKER');
            const agentTurns = server.requests.filter(r => r.users.some(u => u.includes('read the notes')));
            expect(agentTurns.length).toBeGreaterThan(0);
            expect(agentTurns.every(r => r.system.includes('SESSION-CONTEXT-MARKER'))).toBe(true);

            await expect.poll(() => readLog(dir).filter(l => l.event === 'stop').length, { timeout: 20_000 }).toBeGreaterThanOrEqual(2);
            const log = readLog(dir);
            const events = log.filter(l => l.level === 'project').map(l => l.event);
            expect(events.filter(e => e === 'sessionStart')).toHaveLength(1);
            expect(events).toEqual(expect.arrayContaining(['beforeSubmitPrompt', 'preToolUse', 'postToolUse', 'afterAgentResponse', 'stop']));
            expect(log.find(l => l.event === 'preToolUse')?.input).toMatchObject({ tool_name: 'Read', tool_input: { path: 'a.txt' } });
            expect(log.filter(l => l.event === 'stop').map(l => l.input.loop_count)).toEqual([0, 1]);
            // sessionStart's env reaches the later hooks of the chat.
            expect(log.filter(l => l.event !== 'sessionStart').every(l => l.session === 'from-session')).toBe(true);
            // Enterprise hooks run before the project's for the same event.
            const replies = log.filter(l => l.event === 'afterAgentResponse');
            expect(replies[0].level).toBe('enterprise');
            expect(replies.some(l => l.level === 'project')).toBe(true);
        });
    }
});
