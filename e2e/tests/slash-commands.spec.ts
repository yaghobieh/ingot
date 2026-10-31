import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { E2E_CONFIG_DIR } from '../src/e2e.consts';
import { startOpenPlanServer, type FakeIngotServer } from '../src/fake-ingot-server';

/**
 * IDEA-249: `/` lists Markdown commands from `.ingot/commands` and other editors' command / prompt folders in the
 * project and the home folder (fixture home: e2e/fixtures/import-home), deduped with `.ingot` winning, plus built-ins.
 * Each entry shows the folder it came from; frontmatter gives the description and argument hint.
 */
const write = (dir: string, file: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
};

const makeProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-slash-')));
    write(dir, 'src/cart.ts', 'export const total = 1;\n');
    write(dir, '.ingot/commands/review.md', '---\ndescription: Review with the team checklist\n---\nReview $ARGUMENTS. INGOT-REVIEW-MARKER\n');
    write(dir, '.cursor/commands/review.md', 'Review (loses to .ingot).\n');
    write(dir, '.cursor/commands/lint.md', '# Lint the changed files\nRun the linter.\n');
    write(dir, '.github/prompts/release-notes.prompt.md', '---\ndescription: Draft release notes\nargs: <version>\n---\nRelease notes for $ARGUMENTS. RELEASE-MARKER\n');
    write(dir, '.windsurf/workflows/deploy.md', '---\ndescription: Deploy to staging\n---\nDeploy it.\n');
    write(dir, '.claude/commands/explain.md', '---\ndescription: Explain simply\n---\nExplain $ARGUMENTS simply.\n');
    return dir;
};

const composer = (page: Page) => page.locator('#ingot-composer-input');
const item = (page: Page, name: string) => page.locator(`#ingot-slash-item-${name}`);

// The agent chat is a paid feature; the fake account server opens the plan.
let account: FakeIngotServer;
test.beforeEach(async () => {
    account = await startOpenPlanServer();
});
test.afterEach(async () => {
    await account.close();
    fs.rmSync(path.join(E2E_CONFIG_DIR, 'remote-config.json'), { force: true });
});

for (const scheme of ['light', 'dark'] as const) {
    test(`IDEA-249 / lists project, other-folder and home commands, .ingot wins (${scheme})`, async ({ page }) => {
        test.setTimeout(120_000);
        const dir = makeProject();
        const server = await startFakeOllama(() => 'Done.', { delayMs: 0 });
        try {
            await openIngot(page, dir);
            await setAppearance(page, scheme);
            await dismissNotifications(page);
            await connectOllama(page, server);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            await composer(page).focus();
            await page.keyboard.type('/');
            const menu = page.locator('#ingot-slash-menu');
            await expect(menu).toBeVisible();

            const expected: Record<string, string> = {
                review: '.ingot/commands', lint: '.cursor/commands', 'release-notes': '.github/prompts',
                deploy: '.windsurf/workflows', explain: '.claude/commands', standup: '~/.claude/commands'
            };
            for (const [name, folder] of Object.entries(expected)) {
                await expect(item(page, name), name).toBeVisible();
                await expect(item(page, name).locator('.ingot-badge'), name).toHaveText(folder);
            }
            // One /review only, and it is the .ingot one.
            await expect(menu.locator('.ingot-slash-item', { hasText: '/review' })).toHaveCount(1);
            await expect(item(page, 'review')).toContainText('Review with the team checklist');
            await expect(item(page, 'release-notes').locator('.ingot-slash-args')).toHaveText('<version>');
            await expect(item(page, 'lint')).toContainText('Lint the changed files');
            // Built-ins are listed too.
            await expect(menu.locator('#ingot-slash-builtin-plan')).toBeVisible();
            await shot(page, `slash-commands-${scheme}.png`);

            // Picking a command fills it in; sending expands the .ingot file's prompt.
            await page.keyboard.type('rev');
            await expect(menu.locator('.ingot-slash-item')).toHaveCount(1);
            await page.keyboard.press('Enter');
            await expect(composer(page)).toHaveText(/^\/review\s*$/);
            await page.keyboard.type('the cart');
            await page.keyboard.press('Enter');
            await expect.poll(() => server.requests.at(-1)?.user ?? '').toContain('Review the cart. INGOT-REVIEW-MARKER');
            await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('Done.');
            await expect(page.locator('#ingot-composer-stop')).toHaveCount(0);

            // A home-folder command expands too, after the first turn has finished.
            await composer(page).focus();
            await page.keyboard.type('/standup');
            await page.keyboard.press('Enter');
            await page.keyboard.press('Enter');
            await expect.poll(() => server.requests.at(-1)?.user ?? '').toContain('HOME-STANDUP-MARKER');
        } finally {
            await server.close();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
}
