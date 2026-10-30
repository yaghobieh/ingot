import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { makeToolsProject, setAppearance, tokenColor } from '../src/agent-tools.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';

/**
 * Agent panel redesign: prompt card, "Ingot Agent · worked for", one-line checklist, one Explored row for reads and
 * rules, the "Edited N files" card with type badges and +/− counts, reply with a code block, the review bar and the
 * composer (mention chips, Agent mode, model, send). Driven end to end with a scripted local model.
 */
const SHOTS_DIR = process.env.INGOT_SHOTS_DIR;
const PANEL_WIDTH = 440;
const PROMPT = 'Create a new React and Express library app with books, authors, members and loans, plus tests.';
const PLAN = [
    'Scaffold client with Vite and TypeScript',
    'Add books, authors, members and loans pages',
    'Wire API client and shared types',
    'Write server and client tests'
];
const FILES: readonly (readonly [string, number])[] = [
    ['server/src/app.test.ts', 73], ['client/package.json', 22], ['client/tsconfig.test.json', 16], ['client/vite.config.ts', 8],
    ['client/index.html', 13], ['client/src/types.ts', 5], ['client/src/api.ts', 8], ['client/src/styles.css', 7],
    ['client/src/css.d.ts', 2], ['client/src/main.tsx', 9], ['client/src/features/books/Books.tsx', 19],
    ['client/src/features/authors/Authors.tsx', 17], ['client/src/features/members/Members.tsx', 17],
    ['client/src/features/loans/Loans.tsx', 19], ['client/src/App.tsx', 9], ['server/src/index.ts', 15]
];
const ADDED = FILES.reduce((sum, [, lines]) => sum + lines, 0);

const fileBody = (lines: number): string => Array.from({ length: lines }, (_, i) => `// line ${i + 1}`).join('\n');

const finalReply = (): string => [
    'PLAN:',
    ...PLAN.map(item => `- ${item}`),
    'The library app is scaffolded. The server exposes `/api/books`, authors, members and loans, and the client has one page per resource.',
    '',
    '```ts',
    "app.get('/api/books', (_req, res) => res.json(books));",
    'app.listen(3000);',
    '```',
    ...FILES.flatMap(([file, lines]) => [`<<<EDIT ${file}`, fileBody(lines), '>>>END'])
].join('\n');

const save = async (page: Page, name: string): Promise<void> => {
    if (SHOTS_DIR) {
        fs.mkdirSync(SHOTS_DIR, { recursive: true });
        await page.mouse.move(0, 0);
        await page.locator('.ingot-agents-chat').evaluate(el => {
            (document.activeElement as HTMLElement | null)?.blur();
            el.scrollTop = 0;
        });
        await page.locator('.ingot-agents').screenshot({ path: path.join(SHOTS_DIR, name), animations: 'disabled' });
    }
};

const box = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
    const found = await locator.boundingBox();
    expect(found).not.toBeNull();
    return found!;
};

const css = (locator: Locator, prop: string): Promise<string> => locator.evaluate((el, p) => getComputedStyle(el).getPropertyValue(p), prop);

/** Drags the split handle left of the agent panel until the panel is about as wide as the mockup. */
const sizePanel = async (page: Page): Promise<void> => {
    const panel = await box(page.locator('.ingot-agents'));
    const handle = await page.locator('.ingot-agents').evaluate(el => {
        const left = el.getBoundingClientRect().left;
        const rects = Array.from(document.querySelectorAll('.lm-SplitPanel-handle')).map(x => x.getBoundingClientRect())
            .filter(r => r.height > r.width && r.left <= left + 1);
        const nearest = rects.sort((a, b) => Math.abs(a.left - left) - Math.abs(b.left - left))[0];
        return nearest && { x: nearest.left + nearest.width / 2, y: nearest.top + nearest.height / 2 };
    });
    expect(handle).toBeTruthy();
    const { x, y } = handle!;
    await page.mouse.move(x, y);
    await page.mouse.down();
    await page.mouse.move(x + panel.width - PANEL_WIDTH, y, { steps: 8 });
    await page.mouse.up();
    await expect.poll(async () => Math.round((await box(page.locator('.ingot-agents'))).width)).toBeLessThan(PANEL_WIDTH + 12);
};

/** Waits for the run to finish: continues past review checkpoints, skips commands and closes the Zaprex offer. */
const finishRun = async (page: Page): Promise<void> => {
    const offer = page.getByRole('dialog', { name: 'Zaprex Harmony mode offer' }).getByRole('button', { name: 'Dismiss' });
    const interruptions = [offer, page.locator('#ingot-review-continue'), page.locator('#ingot-approval-skip')];
    await expect(async () => {
        for (const button of interruptions) {
            if (await button.isVisible()) {
                await button.click();
            }
        }
        await expect(page.locator('#ingot-changes-summary')).toHaveText(/Edited 16 files/, { timeout: 2_000 });
        await expect(page.locator('.ingot-chat-agent .ingot-md-code')).toBeVisible({ timeout: 1_000 });
        await expect(page.locator('#ingot-composer-stop')).toBeHidden({ timeout: 1_000 });
        for (const button of interruptions) {
            await expect(button).toBeHidden({ timeout: 1_000 });
        }
    }).toPass({ timeout: 90_000 });
};

const reviewOn = async (page: Page): Promise<void> => {
    const dialog = page.locator('#ingot-settings');
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), dialog);
    await page.locator('#ingot-settings-node-agent-review').click();
    const autoAccept = page.locator('#ingot-setting-ingot-agent-review-autoAccept');
    if (await autoAccept.isChecked()) {
        await autoAccept.click();
    }
    const enabled = page.locator('#ingot-setting-ingot-agent-review-enabled');
    if (await enabled.count() && !await enabled.isChecked()) {
        await enabled.click();
    }
    await page.locator('#ingot-settings-ok').click();
    await expect(dialog).toBeHidden();
};

test.describe('agent panel redesign', () => {
    test.setTimeout(180_000);
    let home: string;
    let server: FakeOllama;

    test.beforeEach(async () => {
        home = makeToolsProject('ingot-redesign-');
        fs.writeFileSync(path.join(home, 'AGENTS.md'), '# Agents\nKeep it small.\n');
        fs.mkdirSync(path.join(home, 'server'));
        fs.mkdirSync(path.join(home, 'client'));
        let replied = false;
        server = await startFakeOllama((_system, user) => {
            if (user.startsWith('Tool result (ingot/read_file)')) {
                return '<<<TOOL ingot/list_dir\n{"path": "."}\n>>>END';
            }
            if (user.startsWith('Tool result (ingot/') || replied) {
                const reply = replied ? 'Done.' : finalReply();
                replied = true;
                return reply;
            }
            return '<<<TOOL ingot/read_file\n{"path": "package.json"}\n>>>END';
        }, { delayMs: 0, chunkSize: 400 });
    });

    test.afterEach(async () => {
        await server.close();
        fs.rmSync(home, { recursive: true, force: true });
    });

    test('compact run summary, edited-files card, review bar and composer in light and dark', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 1100 });
        await openIngot(page, home);
        await dismissNotifications(page);
        await setAppearance(page, 'dark');
        await connectOllama(page, server);
        await reviewOn(page);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await sizePanel(page);
        await page.locator('#ingot-composer-input').fill(PROMPT);
        await page.locator('#ingot-composer-input').press('Enter');

        // Prompt card across the thread.
        const prompt = page.locator('.ingot-chat-latest');
        await expect(prompt).toContainText(PROMPT);
        const chat = await box(page.locator('.ingot-agents-chat'));
        expect((await box(prompt)).width).toBeGreaterThan(chat.width - 32);

        // One agent line for the turn, with how long it worked; it shows while the run is still going.
        await expect(page.locator('.ingot-chat-agent-head')).toContainText('Ingot Agent', { timeout: 30_000 });
        await finishRun(page);
        const head = page.locator('.ingot-chat-agent-head');
        await expect(head).toHaveCount(1);
        await expect(head).toContainText('Ingot Agent');
        await expect(head).toContainText(/worked for \d+(m \d+)?s/);

        // Reads and rules fold into one Explored row; no per-read boxes.
        await expect(page.locator('.ingot-chat-read')).toHaveCount(0);
        const explored = page.locator('#ingot-chat-explored');
        await expect(explored).toHaveCount(1);
        await expect(explored).toContainText(/Explored \d+ files?/);
        await explored.locator('.ingot-chat-explored-head').click();
        await expect(explored.locator('li[data-kind="rule"]', { hasText: 'AGENTS.md' })).toBeVisible();
        await expect(explored.locator('li[data-kind="read"]', { hasText: 'package.json' })).toBeVisible();
        await explored.locator('.ingot-chat-explored-head').click();
        await expect(explored.locator('li')).toHaveCount(0);

        // Checklist: one line per step with a green check, no bordered boxes.
        const rows = page.locator('#ingot-checklist .ingot-check-row');
        await expect(rows).toHaveText(PLAN);
        const success = await tokenColor(page, '--ingot-success');
        for (let i = 0; i < PLAN.length; i++) {
            const row = rows.nth(i);
            expect((await box(row)).height).toBeLessThanOrEqual(26);
            expect(await css(row, 'border-top-width')).toBe('0px');
            await expect(row.locator('.codicon-check')).toHaveCSS('color', success);
        }

        // Edited files: colored type badge, name, dim folder, right-aligned +N / −N.
        const files = page.locator('#ingot-review-files .ingot-review-file');
        await expect(files).toHaveCount(FILES.length);
        await expect(page.locator('#ingot-changes-summary .ingot-plus')).toHaveText(`+${ADDED}`);
        const app = files.filter({ has: page.locator('.ingot-review-file-name', { hasText: /^App\.tsx$/ }) });
        await expect(app.locator('.ingot-file-badge')).toHaveText('TSX');
        await expect(app.locator('.ingot-review-file-dir')).toHaveText('client/src');
        await expect(app.locator('.ingot-plus')).toHaveText('+9');
        await expect(app.locator('.ingot-minus.zero')).toHaveText('−0');
        const badges = new Map<string, string>();
        for (const label of ['TS', 'TSX', 'JSON', 'CSS', 'HTML']) {
            const badge = page.locator('#ingot-review-files .ingot-file-badge', { hasText: new RegExp(`^${label}$`) }).first();
            badges.set(label, await css(badge, 'background-color'));
        }
        expect(new Set(badges.values()).size).toBe(badges.size);
        const card = await box(page.locator('#ingot-edited-card'));
        const first = await box(files.first());
        const firstStats = await box(files.first().locator('.ingot-review-file-stats'));
        expect(first.height).toBeLessThanOrEqual(24);
        expect(firstStats.x + firstStats.width).toBeLessThanOrEqual(card.x + card.width);
        expect(firstStats.x + firstStats.width).toBeGreaterThan(card.x + card.width - 40);

        // Reply text with inline code, then a code block with its language and an icon-only copy button.
        const reply = page.locator('.ingot-chat-agent .ingot-md').last();
        await expect(reply.locator('p code', { hasText: '/api/books' })).toBeVisible();
        const block = reply.locator('.ingot-md-code');
        await expect(block.locator('.ingot-md-code-lang')).toHaveText('ts');
        await expect(block.locator('code')).toContainText('app.listen(3000);');
        await expect(block.locator('.ingot-md-copy-label')).toBeHidden();
        await expect(page.locator('.ingot-agents .ingot-change-block')).toHaveCount(0);

        // Review bar: "16 files · +N −0", Reject all / Review / Accept all.
        const bar = page.locator('#ingot-changes-bar');
        await expect(bar.locator('.ingot-review-totals')).toHaveText(`16 files · +${ADDED} −0`);
        await expect(bar.locator('button')).toHaveText(['Reject all', 'Review', 'Accept all']);
        await expect(page.locator('#ingot-changes-accept-all')).toHaveCSS('background-color', await tokenColor(page, '--ingot-primary'));

        // Composer: placeholder, attach, Agent mode, model, send in one bar.
        const input = page.locator('#ingot-composer-input');
        await expect(input).toHaveAttribute('data-placeholder', 'Ask anything, @ to mention, / for actions');
        await expect(page.locator('.ingot-composer-bar #ingot-composer-mode')).toHaveText('Agent');
        for (const id of ['#ingot-composer-attach', '#ingot-composer-mode', '#ingot-composer-model', '#ingot-composer-send']) {
            await expect(page.locator(`.ingot-composer-bar ${id}`)).toBeVisible();
        }
        await save(page, 'agent-panel-redesign-dark.png');

        // Mentions become badged context chips.
        await input.click();
        await page.keyboard.type('@client/src/App.tsx @server/ ');
        const chips = page.locator('#ingot-composer-chips .ingot-context-chip');
        await expect(chips).toHaveText(['TSXApp.tsx', 'DIRserver/']);
        await save(page, 'agent-panel-redesign-chips-dark.png');
        await input.fill('');
        await expect(chips).toHaveCount(0);

        // The mode dropdown opens the mode menu from the bar.
        await page.locator('#ingot-composer-mode').click();
        await expect(page.locator('#ingot-mode-plan')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#ingot-mode-plan')).toBeHidden();

        await setAppearance(page, 'light');
        await expect(page.locator('body')).toHaveClass(/ingot-light/);
        await expect(page.locator('#ingot-changes-accept-all')).toHaveCSS('background-color', await tokenColor(page, '--ingot-primary'));
        await save(page, 'agent-panel-redesign-light.png');

        // Collapse and reopen the card; reject one file on hover, then accept the rest.
        await page.locator('#ingot-changes-summary').click();
        await expect(files).toHaveCount(0);
        await page.locator('#ingot-changes-summary').click();
        await expect(files).toHaveCount(FILES.length);
        await app.hover();
        await app.locator('.ingot-review-file-reject').click();
        await expect(app.locator('.ingot-review-file-state')).toHaveText('Rejected');
        await expect(bar.locator('.ingot-review-totals')).toContainText('15 files');
        await page.locator('#ingot-changes-accept-all').click();
        await expect(bar).toBeHidden();
        await expect(files.first().locator('.ingot-review-file-state')).toHaveText('Accepted');
        await expect.poll(() => fs.existsSync(path.join(home, 'client', 'src', 'api.ts'))).toBe(true);
        expect(fs.existsSync(path.join(home, 'client', 'src', 'App.tsx'))).toBe(false);
    });
});
