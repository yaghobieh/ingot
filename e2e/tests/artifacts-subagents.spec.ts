import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { makeToolsProject, setAppearance } from '../src/agent-tools.e2e-utils';

/**
 * IDEA-290 + IDEA-291: the lead agent plans and starts two `ingot/task` subagents (one in its own git worktree).
 * The Agent Manager lists them with the approval one of them waits on; a comment on plan.md in the Artifacts
 * view steers the running lead; Jump to Next Approval + Run lets the subagent finish and report back.
 */
const SHOTS = process.env.INGOT_SHOTS;
const COMMENT = 'use papaparse';
const RUN_COMMAND = 'echo parsed > parsed.txt';
const block = (tool: string, args: Record<string, unknown>): string => `<<<TOOL ingot/${tool}\n${JSON.stringify(args)}\n>>>END\n`;

const reply = (_system: string, user: string): string => {
    if (user.includes('TASK-PARSE')) {
        return `Writing the parser output.\n\n${block('run', { command: RUN_COMMAND })}`;
    }
    if (user.startsWith('Tool result (ingot/run)')) {
        return 'Parser done: wrote parsed.txt.';
    }
    if (user.includes('TASK-MENU')) {
        return 'Menu checked: the export item already exists, no change needed.';
    }
    if (user.includes('Comment on artifact')) {
        return 'Noted the comment: switching the parser to papaparse.';
    }
    if (user.startsWith('Tool result (ingot/task)')) {
        return 'Both subagents are done.';
    }
    return [
        'PLAN:', '- Parse the CSV file', '- Check the export menu', '',
        'Splitting this into two subagents.', '',
        block('task', { description: 'Parse CSV', prompt: 'Write the CSV parser output. TASK-PARSE' }),
        block('task', { description: 'Export menu', prompt: 'Check the export menu. TASK-MENU', worktree: true })
    ].join('\n');
};

const save = async (page: Page, name: string): Promise<void> => {
    if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SHOTS, name) });
    }
};

test.describe('IDEA-290 artifacts + IDEA-291 task subagents and Agent Manager', () => {
    test.setTimeout(240_000);
    let dir: string;
    let server: FakeOllama;
    const git = (...args: string[]): string => execFileSync('git', args, { cwd: dir, encoding: 'utf8' });

    test.beforeEach(async () => {
        dir = makeToolsProject('ingot-artifacts-');
        git('init', '-q', '-b', 'feature/csv');
        git('config', 'user.name', 'Ingot E2E');
        git('config', 'user.email', 'e2e@ingot.dev');
        git('add', '.');
        git('commit', '-qm', 'Initial');
        server = await startFakeOllama(reply, { delayMs: 5 });
    });

    test.afterEach(async () => {
        await server?.close();
        for (const line of git('worktree', 'list', '--porcelain').split('\n').filter(l => l.startsWith('worktree ')).slice(1)) {
            execFileSync('git', ['worktree', 'remove', '--force', line.slice('worktree '.length)], { cwd: dir });
        }
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('plan.md comment steers the lead; subagents run in parallel and the manager answers their approval', async ({ page }) => {
        await openIngot(page, dir);
        await dismissNotifications(page);
        await setAppearance(page, 'dark');
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await page.locator('#ingot-composer-input').fill('Add CSV import');
        await page.locator('#ingot-composer-input').press('Enter');

        // Agent Manager (Ctrl+Alt+Shift+M): the lead, its two subagents, and the approval the parser waits on.
        const manager = page.locator('#ingot-agent-manager');
        await actUntilVisible(() => page.keyboard.press('Control+Alt+Shift+M'), manager);
        const approval = manager.locator('.ingot-am-approval');
        await expect(approval).toHaveCount(1, { timeout: 45_000 });
        await expect(approval.locator('.ingot-am-approval-line')).toHaveText(`Run command: ${RUN_COMMAND}`);
        await expect(approval.locator('.ingot-am-approval-title')).toHaveText('Parse CSV');
        const rows = manager.locator('.ingot-am-row');
        await expect(rows).toHaveCount(3);
        await expect(rows.nth(0)).toContainText('Add CSV import');
        await expect(rows.nth(0)).toHaveAttribute('data-state', 'running');
        await expect(rows.nth(0).locator('.ingot-am-step')).toContainText('Running subagent');
        await expect(manager.locator('.ingot-am-row[data-state="approval"]')).toContainText('Parse CSV');
        const menuRow = manager.locator('.ingot-am-row', { hasText: 'Export menu' });
        await expect(menuRow.locator('.ingot-am-chip')).toContainText('ingot/task-', { timeout: 30_000 });
        await expect(menuRow).toHaveAttribute('data-state', 'done', { timeout: 30_000 });
        await expect(manager.locator('#ingot-am-summary')).toContainText('1 waiting for approval');

        // Artifacts (Ctrl+Alt+Shift+K): plan.md from the lead's PLAN; a comment on line 3 steers the running lead.
        const viewer = page.locator('#ingot-artifacts');
        await actUntilVisible(() => page.keyboard.press('Control+Alt+Shift+K'), viewer);
        await expect(viewer.locator('#ingot-art-status')).toHaveText('Agent running: comments steer it');
        await expect(viewer.locator('.ingot-art-tab.active')).toHaveText('plan.md');
        const line = viewer.locator('.ingot-art-line[data-line="3"]');
        await expect(line).toContainText('Parse the CSV file');
        await line.hover();
        await line.locator('.ingot-art-add').click();
        await page.keyboard.type(COMMENT);
        await save(page, 'artifacts-comment-dark.png');
        await page.keyboard.press('Enter');
        const comment = viewer.locator('.ingot-art-comment');
        await expect(comment).toContainText(COMMENT);
        await expect(comment.locator('.ingot-art-comment-state')).toHaveText('Sent to agent');
        await save(page, 'artifacts-dark.png');

        // Jump to Next Approval (Ctrl+Alt+Shift+J) lands on the parser's action; Run lets it finish.
        await page.keyboard.press('Control+Alt+Shift+J');
        await expect(manager.locator('.ingot-am-approval.focused')).toHaveCount(1);
        await save(page, 'agent-manager-dark.png');
        await manager.locator('.ingot-am-approval.focused .ingot-am-run').click();
        await expect(approval).toHaveCount(0);
        await expect(rows.nth(0)).toHaveAttribute('data-state', 'idle', { timeout: 45_000 });
        await expect(manager.locator('.ingot-am-row[data-state="done"]')).toHaveCount(2);

        // The lead read the comment and both subagent summaries; the subagent ran the command in the project.
        await expect(page.locator('#ingot-agents .ingot-agents-chat')).toContainText('Noted the comment', { timeout: 30_000 });
        const users = server.requests.flatMap(r => r.users);
        expect(users.some(u => u.includes(`Comment on artifact plan.md line 3 ("- [ ] Parse the CSV file"): ${COMMENT}`))).toBe(true);
        expect(users.some(u => u.includes('Subagent "Parse CSV" done.') && u.includes('Parser done: wrote parsed.txt.'))).toBe(true);
        expect(users.some(u => u.includes('Subagent "Export menu" done.') && u.includes('Worktree: '))).toBe(true);
        // Clean context: a subagent's request carries only its own task, not the lead's prompt.
        const parse = server.requests.find(r => r.user.includes('TASK-PARSE'));
        expect(parse?.users).toHaveLength(1);
        expect(fs.readFileSync(path.join(dir, 'parsed.txt'), 'utf8').trim()).toBe('parsed');
        expect(git('worktree', 'list')).toContain('[ingot/task-');

        // The run folder has plan.md, walkthrough.md, run.json and the saved comment.
        const runs = fs.readdirSync(path.join(dir, '.ingot', 'artifacts'));
        const lead = runs.map(r => path.join(dir, '.ingot', 'artifacts', r)).find(r => fs.existsSync(path.join(r, 'plan.md')));
        expect(lead).toBeTruthy();
        await expect.poll(() => fs.existsSync(path.join(lead!, 'walkthrough.md')), { timeout: 15_000 }).toBe(true);
        expect(JSON.parse(fs.readFileSync(path.join(lead!, 'comments.json'), 'utf8'))[0]).toMatchObject({ file: 'plan.md', line: 3, text: COMMENT, sent: true });
        await viewer.locator('.ingot-art-tab', { hasText: 'walkthrough.md' }).click();
        await expect(viewer.locator('.ingot-art-doc')).toContainText('Walkthrough: Add CSV import');
        await expect(viewer.locator('.ingot-art-doc')).not.toContainText('Comment on artifact');
        await save(page, 'artifacts-walkthrough-dark.png');

        await setAppearance(page, 'light');
        await viewer.locator('.ingot-art-tab', { hasText: 'plan.md' }).click();
        await save(page, 'artifacts-light.png');
    });
});
