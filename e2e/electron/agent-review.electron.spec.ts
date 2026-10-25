import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { launchDesktop, type DesktopApp } from '../src/electron.utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/** IDEA-105: changed-files review list, checkpoint pause, auto-continue countdown, review off, inline comments → agent fix. */
const FILES = ['a', 'b', 'c', 'd', 'e'].map(n => `src/${n}.ts`);
const original = (f: string): string => `export const ${path.basename(f, '.ts')} = 1;\nexport const keep = true;\n`;
const edited = (f: string): string => `export const ${path.basename(f, '.ts')} = 2;\nexport const keep = true;\n`;
const editsReply = (files: readonly string[]): string => `Updating ${files.length} files.\n\n${files.map(f => `<<<EDIT ${f}\n${edited(f)}>>>END`).join('\n\n')}\n`;
const FIXED_A = 'export const a = 3;\nexport const keep = true;\n';

const SHOTS = process.env.INGOT_SHOTS;
const shot = async (page: Page, name: string): Promise<void> => {
    if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, name) });
    }
};

test.describe('IDEA-105 agent review (desktop)', () => {
    test.setTimeout(240_000);
    let dir: string;
    let desktop: DesktopApp;
    let server: FakeOllama;

    const start = async (settings: Record<string, unknown>, reply: (system: string, user: string) => string): Promise<Page> => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-review-')));
        fs.mkdirSync(path.join(dir, 'src'));
        FILES.forEach(f => fs.writeFileSync(path.join(dir, f), original(f)));
        server = await startFakeOllama(reply, { delayMs: 0 });
        desktop = await launchDesktop(dir, {}, settings);
        const { page } = desktop;
        await connectOllama(page, server);
        if (!await page.locator('#ingot-composer-input').isVisible()) {
            await page.locator('#ingot-rs-agents').click();
        }
        await pickModel(page, 'ollama-local');
        return page;
    };
    const ask = async (page: Page, text: string): Promise<void> => {
        await page.locator('#ingot-composer-input').click();
        await page.keyboard.type(text);
        await page.keyboard.press('Enter');
    };
    const read = (f: string): string => fs.readFileSync(path.join(dir, f), 'utf8');

    test.afterEach(async () => {
        await desktop?.close();
        await server?.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('checkpoint pause at the threshold, review list with per-file Accept / Reject, Continue now, Accept All', async () => {
        const page = await start({ 'ingot.agent.reviewPauseThreshold': 2, 'ingot.agent.reviewAutoContinueSeconds': 0 }, () => editsReply(FILES));
        await ask(page, 'Bump every constant');
        const pause = page.locator('#ingot-review-pause');
        await expect(pause).toContainText('Paused for review · 2 of 5 files applied', { timeout: 20_000 });
        await expect(page.locator('#ingot-review-countdown')).toHaveCount(0);
        const rows = page.locator('#ingot-review-files .ingot-review-file');
        await expect(rows).toHaveCount(2);
        await expect(rows.nth(0)).toContainText('a.ts');
        await expect(rows.nth(0).locator('.ingot-review-file-stats')).toHaveText('+1 −1');
        await expect(rows.nth(0).locator('.ingot-review-file-state')).toHaveText('Pending');
        await shot(page, 'idea-105-pause-light.png');

        await rows.nth(0).locator('.ingot-review-file-accept').click();
        await expect(rows.nth(0).locator('.ingot-review-file-state')).toHaveText('Accepted');
        await expect.poll(() => read('src/a.ts')).toBe(edited('src/a.ts'));
        await rows.nth(1).locator('.ingot-review-file-reject').click();
        await expect(rows.nth(1).locator('.ingot-review-file-state')).toHaveText('Rejected');
        expect(read('src/b.ts')).toBe(original('src/b.ts'));
        // The rest was not applied while paused.
        await expect(page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: 'c.ts' })).toHaveCount(0);

        await page.locator('#ingot-review-continue').click();
        await expect(pause).toContainText('4 of 5 files applied', { timeout: 15_000 });
        await expect(rows).toHaveCount(4);
        // Clicking a file opens its diff.
        await rows.nth(2).click();
        await expect(page.locator('#theia-main-content-panel .lm-TabBar-tab.lm-mod-current', { hasText: 'c.ts' })).toBeVisible();
        await expect(page.locator('.ingot-hunk-accept').first()).toBeVisible();
        await page.locator('#ingot-review-continue').click();
        await expect(pause).toHaveCount(0, { timeout: 15_000 });
        await expect(rows).toHaveCount(5);
        await page.locator('#ingot-changes-accept-all').click();
        for (const f of ['src/c.ts', 'src/d.ts', 'src/e.ts']) {
            await expect.poll(() => read(f)).toBe(edited(f));
        }
        expect(read('src/b.ts')).toBe(original('src/b.ts'));
    });

    test('auto-continue countdown runs out by itself; Wait stops it; the default threshold (10) does not pause 5 files', async () => {
        const page = await start({ 'ingot.agent.reviewPauseThreshold': 1, 'ingot.agent.reviewAutoContinueSeconds': 2 }, () => editsReply(FILES.slice(0, 3)));
        await ask(page, 'Bump three constants');
        const pause = page.locator('#ingot-review-pause');
        await expect(pause).toContainText('1 of 3 files applied', { timeout: 20_000 });
        await expect(page.locator('#ingot-review-countdown')).toHaveText(/Continuing in 0:0[12]/);
        // No interaction: it continues to the next checkpoint on its own.
        await expect(pause).toContainText('2 of 3 files applied', { timeout: 10_000 });
        await page.locator('#ingot-review-wait').click();
        await expect(page.locator('#ingot-review-countdown')).toHaveCount(0);
        await page.waitForTimeout(3_000);
        await expect(pause).toContainText('2 of 3 files applied');
        await page.locator('#ingot-review-continue').click();
        await expect(pause).toHaveCount(0, { timeout: 15_000 });
        await expect(page.locator('#ingot-review-files .ingot-review-file')).toHaveCount(3);

        // Threshold change from Settings › Agent review: back to the default 10, then 5 files run without a pause.
        await page.locator('#ingot-changes-accept-all').click();
        await page.keyboard.press('Meta+,');
        await page.locator('#ingot-settings-node-agent-review').click();
        const threshold = page.locator('#ingot-setting-ingot-agent-reviewPauseThreshold');
        await expect(threshold).toHaveValue('1');
        await threshold.fill('10');
        await page.locator('#ingot-settings-ok').click();
        await server.close();
        server = await startFakeOllama(() => editsReply(FILES), { delayMs: 0 });
        await connectOllama(page, server);
        await ask(page, 'Bump every constant');
        await expect(page.locator('#ingot-review-files .ingot-review-file')).toHaveCount(5, { timeout: 20_000 });
        await expect(pause).toHaveCount(0);
        // Decide everything so the window closes without unsaved editors.
        await page.locator('#ingot-changes-accept-all').click();
        await expect(page.locator('#ingot-changes-accept-all')).toHaveCount(0);
    });

    test('review off: edits apply right away, no pause or countdown, the list is information only', async () => {
        const page = await start({ 'ingot.agent.review.enabled': false, 'ingot.agent.reviewPauseThreshold': 1, 'ingot.agent.reviewAutoContinueSeconds': 1 }, () => editsReply(FILES.slice(0, 3)));
        await expect(page.locator('#ingot-composer-review')).toHaveAttribute('aria-pressed', 'false');
        await ask(page, 'Bump three constants');
        for (const f of FILES.slice(0, 3)) {
            await expect.poll(() => read(f), { timeout: 20_000 }).toBe(edited(f));
        }
        await expect(page.locator('#ingot-review-pause')).toHaveCount(0);
        const rows = page.locator('#ingot-review-files.info .ingot-review-file');
        await expect(rows).toHaveCount(3);
        await expect(rows.first().locator('.ingot-review-file-state')).toHaveText('Applied');
        await expect(page.locator('.ingot-review-file-accept')).toHaveCount(0);
        await expect(page.locator('#ingot-changes-accept-all')).toHaveCount(0);
        // The composer quick toggle turns review back on.
        await page.locator('#ingot-composer-review').click();
        await expect(page.locator('#ingot-composer-review')).toHaveAttribute('aria-pressed', 'true');
    });

    test('inline review comment → Finish review → the agent fixes it and the comment resolves', async () => {
        const page = await start({ 'ingot.appearance': 'dark' }, (_system, user) => {
            const id = /\[(c\d+)\] line/.exec(user)?.[1];
            return id ? `Fixed.\n\n<<<EDIT src/a.ts\n${FIXED_A}>>>END\n\n[resolved: ${id}]` : editsReply(['src/a.ts']);
        });
        await ask(page, 'Bump a');
        const rows = page.locator('#ingot-review-files .ingot-review-file');
        await expect(rows).toHaveCount(1, { timeout: 20_000 });
        await rows.first().click();
        const editor = page.locator('#theia-main-content-panel .monaco-editor').first();
        // Hover line 2: a + shows in the gutter; click it to comment under that line.
        const line2 = editor.locator('.view-line').nth(1);
        await line2.hover();
        const plus = editor.locator('.ingot-review-plus');
        await expect(plus).toBeVisible();
        await plus.click();
        const box = page.locator('#ingot-review-compose');
        await expect(box).toBeVisible();
        await box.locator('textarea').fill('Use 3 here, not 2.');
        await box.locator('.ingot-review-compose-add').click();
        const comment = page.locator('.ingot-review-comment.draft');
        await expect(comment).toContainText('Use 3 here, not 2.');
        await expect(page.locator('#ingot-review-comments-count')).toHaveText('1 pending comment');
        await shot(page, 'idea-105-comment-dark.png');

        await page.locator('#ingot-review-submit').click();
        await expect.poll(() => server.requests.at(-1)?.user ?? '').toContain('Review comments (1)');
        const sent = server.requests.at(-1)!.user;
        expect(sent).toContain('### src/a.ts');
        expect(sent).toContain('Use 3 here, not 2.');
        // The agent's fix arrives as a new code-change block; the comment is resolved and leaves the editor.
        await expect(page.locator('#ingot-agents .ingot-change-block')).toHaveCount(2, { timeout: 20_000 });
        await expect(page.locator('.ingot-review-comment')).toHaveCount(0, { timeout: 10_000 });
        await page.locator('#ingot-changes-accept-all').click();
        await expect.poll(() => read('src/a.ts')).toBe(FIXED_A);
    });
});
