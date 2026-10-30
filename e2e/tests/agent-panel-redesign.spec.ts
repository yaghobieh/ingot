import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { makeToolsProject, setAppearance, tokenColor } from '../src/agent-tools.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';

/**
 * Agent panel redesign, sized like the reference mock (438 x 1033 inside its frame): 40px header with the accent
 * underline and 28px icon buttons, prompt card, "Ingot Agent · worked for" with the Rex glyph, checklist, the
 * "Edited 16 files" card with 24px rows and 30px badges, the reply with a bash block, the 46px review bar and the
 * composer. Driven end to end with a scripted local model; INGOT_SHOTS_DIR saves the panel in dark and light.
 */
const SHOTS_DIR = process.env.INGOT_SHOTS_DIR;
const PANEL_WIDTH = 438;
const PANEL_HEIGHT = 1033;
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
    ['client/src/features/loans/Loans.tsx', 19], ['client/src/App.tsx', 9], ['client/src/App.test.tsx', 11]
];
const ADDED = FILES.reduce((sum, [, lines]) => sum + lines, 0);

const fileBody = (lines: number): string => Array.from({ length: lines }, (_, i) => `// line ${i + 1}`).join('\n');

const finalReply = (): string => [
    'PLAN:',
    ...PLAN.map(item => `- ${item}`),
    'The library app is scaffolded. The server exposes `/api/books`, authors, members and loans, and the client has one page per resource.',
    '',
    // A printed line that starts with npm becomes a run action in Agent mode, so these start with cd.
    '```bash',
    'cd client && npm install',
    'cd .. && npm run dev --workspace client',
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

/** Drags the split handle left of the agent panel to the mock width, then sizes the window to the mock height. */
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
    await expect.poll(async () => Math.abs(Math.round((await box(page.locator('.ingot-agents'))).width) - PANEL_WIDTH)).toBeLessThanOrEqual(1);
    const viewport = page.viewportSize()!;
    const height = (await box(page.locator('.ingot-agents'))).height;
    await page.setViewportSize({ width: viewport.width, height: viewport.height + PANEL_HEIGHT - Math.round(height) });
    await expect.poll(async () => Math.round((await box(page.locator('.ingot-agents'))).height)).toBe(PANEL_HEIGHT);
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
        fs.mkdirSync(path.join(home, 'server'));
        fs.mkdirSync(path.join(home, 'client'));
        server = await startFakeOllama((_system, user) => user.startsWith(PROMPT) ? finalReply() : 'Done.', { delayMs: 0, chunkSize: 400 });
    });

    test.afterEach(async () => {
        await server.close();
        fs.rmSync(home, { recursive: true, force: true });
    });

    test('panel matches the reference sizes in dark and maps to tokens in light', async ({ page }) => {
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

        await expect(page.locator('.ingot-chat-agent-head')).toContainText('Ingot Agent', { timeout: 30_000 });
        await finishRun(page);

        // Header: 40px plus its border, the accent underline under the title, New / History / More as 28px icon buttons.
        const accent = await tokenColor(page, '--ingot-agent-accent');
        const header = page.locator('.ingot-agents-header');
        expect(Math.round((await box(header)).height)).toBe(41);
        expect(await page.locator('.ingot-chat-tab.active').evaluate(el => getComputedStyle(el, '::after').backgroundColor)).toBe(accent);
        for (const id of ['#ingot-agents-new', '#ingot-agents-history', '#ingot-agents-more']) {
            const button = await box(page.locator(id));
            expect([Math.round(button.width), Math.round(button.height)]).toEqual([28, 28]);
        }
        await page.locator('#ingot-agents-more').click();
        await expect(page.locator('#ingot-agents-header-menu #ingot-agents-processes')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#ingot-agents-header-menu')).toBeHidden();

        // One agent line with the Rex glyph alone (no colored box), 20px.
        const head = page.locator('.ingot-chat-agent-head');
        await expect(head).toHaveCount(1);
        await expect(head).toContainText(/worked for \d+(m \d+)?s/);
        const mark = head.locator('svg.ingot-rex-mark.ingot-agent-mark');
        await expect(mark).toBeVisible();
        await expect(mark).toHaveCSS('background-color', 'rgba(0, 0, 0, 0)');
        expect(Math.round((await box(mark)).width)).toBe(20);
        await expect(mark.locator('rect')).toHaveCount(0);
        // The e2e home imports an always-on rule; rules fold into one quiet Explored row, never per-read boxes.
        await expect(page.locator('.ingot-chat-read')).toHaveCount(0);
        await expect(page.locator('#ingot-chat-explored')).toHaveText(/Explored 1 file/);

        // Checklist: one line per step with a green check icon, no boxes.
        const rows = page.locator('#ingot-checklist .ingot-check-row');
        await expect(rows).toHaveText(PLAN);
        const success = await tokenColor(page, '--ingot-agent-success');
        for (let i = 0; i < PLAN.length; i++) {
            const row = rows.nth(i);
            expect(await css(row, 'border-top-width')).toBe('0px');
            await expect(row.locator('.ingot-plan-check svg')).toHaveCSS('color', success);
        }

        // Edited files: 24px rows, 30px JetBrains Mono badges, name, dim folder, right-aligned +N / −N.
        const files = page.locator('#ingot-review-files .ingot-review-file');
        await expect(files).toHaveCount(FILES.length);
        expect(Math.round((await box(page.locator('#ingot-changes-summary'))).height)).toBe(34);
        await expect(page.locator('#ingot-changes-summary .ingot-plus')).toHaveText(`+${ADDED}`);
        const app = files.filter({ has: page.locator('.ingot-review-file-name', { hasText: /^App\.tsx$/ }) });
        await expect(app.locator('.ingot-file-badge')).toHaveText('TSX');
        await expect(app.locator('.ingot-review-file-dir')).toHaveText('client/src');
        await expect(app.locator('.ingot-plus')).toHaveText('+9');
        await expect(app.locator('.ingot-minus.zero')).toHaveText('−0');
        expect(await css(app.locator('.ingot-plus'), 'font-family')).toContain('JetBrains Mono');
        const badges = new Map<string, string>();
        for (const label of ['TS', 'TSX', 'JSON', 'CSS', 'HTML']) {
            const badge = page.locator('#ingot-review-files .ingot-file-badge', { hasText: new RegExp(`^${label}$`) }).first();
            expect(Math.round((await box(badge)).width)).toBe(30);
            badges.set(label, await css(badge, 'background-color'));
        }
        expect(new Set(badges.values()).size).toBe(badges.size);
        const card = await box(page.locator('#ingot-edited-card'));
        const first = await box(files.first());
        const firstStats = await box(files.first().locator('.ingot-review-file-stats'));
        expect(Math.round(first.height)).toBe(24);
        expect(firstStats.x + firstStats.width).toBeLessThanOrEqual(card.x + card.width - 9);
        expect(firstStats.x + firstStats.width).toBeGreaterThan(card.x + card.width - 12);

        // Reply text with inline code, then a code block with an icon-only copy button.
        const reply = page.locator('.ingot-chat-agent .ingot-md').last();
        await expect(reply.locator('p code', { hasText: '/api/books' })).toBeVisible();
        const block = reply.locator('.ingot-md-code');
        await expect(block.locator('.ingot-md-code-lang')).toHaveText('bash');
        await expect(block.locator('code')).toContainText('npm run dev --workspace client');
        await expect(block.locator('.ingot-md-copy svg')).toBeVisible();
        await expect(block.locator('.ingot-md-copy-label')).toBeHidden();
        await expect(page.locator('.ingot-agents .ingot-change-block')).toHaveCount(0);

        // Review bar: 46px, "16 files · +N −0", Reject all / Review / Accept all.
        const bar = page.locator('#ingot-changes-bar');
        expect(Math.round((await box(bar)).height)).toBe(46);
        await expect(bar.locator('.ingot-review-totals')).toHaveText(`16 files · +${ADDED} −0`);
        await expect(bar.locator('button')).toHaveText(['Reject all', 'Review', 'Accept all']);
        await expect(page.locator('#ingot-changes-accept-all')).toHaveCSS('background-color', accent);

        // Composer: placeholder, then attach, Agent mode, model and a 30px send.
        const input = page.locator('#ingot-composer-input');
        await expect(input).toHaveAttribute('data-placeholder', 'Ask anything, @ to mention, / for actions');
        await expect(page.locator('.ingot-composer-bar #ingot-composer-mode')).toHaveText('Agent');
        for (const id of ['#ingot-composer-attach', '#ingot-composer-mode', '#ingot-composer-model', '#ingot-composer-send']) {
            await expect(page.locator(`.ingot-composer-bar ${id}`)).toBeVisible();
        }
        const send = await box(page.locator('#ingot-composer-send'));
        expect([Math.round(send.width), Math.round(send.height)]).toEqual([30, 30]);
        await expect(page.locator('#ingot-composer-send')).toHaveCSS('background-color', accent);
        await save(page, 'agent-panel-redesign-dark.png');

        // Mentions become badged context chips.
        await input.click();
        await page.keyboard.type('@client/src/App.tsx @server/ ');
        const chips = page.locator('#ingot-composer-chips .ingot-context-chip');
        await expect(chips).toHaveText(['TSXApp.tsx', 'DIRserver/']);
        await expect(chips.first()).toHaveCSS('height', '22px');
        await save(page, 'agent-panel-redesign-chips-dark.png');
        // Same content as the mock for the pixel comparison: it has no rules row.
        await page.locator('#ingot-chat-explored').evaluate(el => { el.style.display = 'none'; });
        await save(page, 'compare-ours-dark.png');
        // Offsets measured on the rendered mock (panel-relative y and height).
        const panelTop = (await box(page.locator('.ingot-agents'))).y;
        const at = async (selector: string): Promise<[number, number]> => {
            const found = await box(page.locator(selector).first());
            return [Math.round(found.y - panelTop), Math.round(found.height)];
        };
        expect(await at('.ingot-chat-agent-head')).toEqual([132, 20]);
        expect(await at('#ingot-checklist')).toEqual([166, 96]);
        expect(await at('#ingot-edited-card')).toEqual([276, 390]);
        expect(await at('#ingot-review')).toEqual([842, 47]);
        expect(await at('.ingot-composer')).toEqual([889, 132]);
        await page.locator('#ingot-chat-explored').evaluate(el => { el.style.display = ''; });
        await input.fill('');
        await expect(chips).toHaveCount(0);

        // The mode dropdown opens the mode menu from the bar.
        await page.locator('#ingot-composer-mode').click();
        await expect(page.locator('#ingot-mode-plan')).toBeVisible();
        await page.keyboard.press('Escape');
        await expect(page.locator('#ingot-mode-plan')).toBeHidden();

        await setAppearance(page, 'light');
        await expect(page.locator('body')).toHaveClass(/ingot-light/);
        await expect(page.locator('#ingot-changes-accept-all')).toHaveCSS('background-color', await tokenColor(page, '--ingot-agent-accent'));
        await expect(page.locator('.ingot-agents')).toHaveCSS('background-color', await tokenColor(page, '--ingot-agent-bg'));
        await save(page, 'agent-panel-redesign-light.png');
        await input.click();
        await page.keyboard.type('@client/src/App.tsx @server/ ');
        await expect(chips).toHaveCount(2);
        await page.locator('#ingot-chat-explored').evaluate(el => { el.style.display = 'none'; });
        await save(page, 'compare-ours-light.png');
        await page.locator('#ingot-chat-explored').evaluate(el => { el.style.display = ''; });
        await input.fill('');

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
