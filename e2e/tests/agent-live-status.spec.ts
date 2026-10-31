import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickMode, pickModel } from '../src/chat.e2e-utils';
import { setAppearance, SHOTS_DIR, toolBlock } from '../src/agent-tools.e2e-utils';

/**
 * The live status line follows the real step of a run: "Thinking…" with typing dots before the first token,
 * "Typing…" while the reply streams, then the tool call that runs ("Searching the codebase…", "Reading 3 files…",
 * "Running tests…"), "Editing App.tsx…" while an edit streams and "Almost there…" while the run wraps up.
 * Every label the user sees is recorded, in light and dark; reduced motion stops the dots and the fade.
 */
const STREAM = { chunkSize: 4, delayMs: 60, firstDelayMs: 1_500 };
const TEST_SECONDS = 2.5;
const LONG_LINE = 'export const lineTotal = (price: number, qty: number): number => price * qty;\n';
const APP = 'export const App = (): string => `Total: ${total()}`;\n';
const PROMPT = 'fix the cart total rounding';
const PLAIN_PROMPT = 'one more pass';
const SUMMARY = 'The cart total now rounds once at the end, so the lines add up to the total shown at checkout.';
const LABEL = '#ingot-chat-working .ingot-shimmer';
const SEEN_GLOBAL = '__ingotLiveSeen';
const STEP_TIMEOUT = 45_000;
const SHOT_NOTES = 'status-shots.log';
const TIMER_GATE = '__ingotTimerGate';

/** One round per step of a real fix: search, read three files, run the tests, stream the edit, then sum up. */
const replyFor = (user: string): string => {
    if (user.startsWith('Tool result (ingot/grep)')) {
        return `Reading the cart files.\n\n${['src/cart.ts', 'src/totals.ts', 'src/App.tsx'].map(p => toolBlock('read_file', { path: p }).replace('On it.\n\n', '')).join('')}`;
    }
    if (user.startsWith('Tool result (ingot/read_file)')) {
        return `Checking the current tests.\n\n${toolBlock('run', { command: 'npm test' }).replace('On it.\n\n', '')}`;
    }
    if (user.startsWith('Tool result (ingot/run)')) {
        return `<<<EDIT src/App.tsx\n${APP}${'// rounded once at the end\n'.repeat(6)}>>>END\n${SUMMARY}`;
    }
    if (user.includes(PLAIN_PROMPT)) {
        return SUMMARY;
    }
    return `Let me find where the total is computed.\n\n${toolBlock('grep', { pattern: 'total' }).replace('On it.\n\n', '')}`;
};

const openSettingsPage = async (page: Page, id: string): Promise<void> => {
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), page.locator('#ingot-settings'));
    await page.locator(`#ingot-settings-node-${id}`).click();
};

/** Records every label the status line paints (with "[dots]" when the typing dots show), in order. */
const recordLabels = (page: Page): Promise<void> => page.evaluate(([selector, key]) => {
    const seen: string[] = [];
    (window as unknown as Record<string, string[]>)[key] = seen;
    const record = (): void => {
        const text = document.querySelector(selector)?.textContent ?? '';
        const entry = text && document.querySelector('#ingot-chat-typing') ? `${text} [dots]` : text;
        if (entry && seen[seen.length - 1] !== entry) {
            seen.push(entry);
        }
    };
    new MutationObserver(record).observe(document.body, { subtree: true, childList: true, characterData: true });
}, [LABEL, SEEN_GLOBAL] as const).then(() => installTimerGate(page));

/**
 * Lets a shot pause the page's timers (like a debugger pause): the status line's hold is a timer, so the last step
 * ("Almost there…", up for its 450 ms hold only) stays on screen until a full-window shot is taken.
 */
const installTimerGate = (page: Page): Promise<void> => page.evaluate(key => {
    const w = window as unknown as Record<string, unknown>;
    if (w[key]) {
        return;
    }
    const gate = { closed: false, queued: [] as Array<() => void>, cancelled: new Set<unknown>() };
    w[key] = gate;
    const realSet = window.setTimeout.bind(window);
    const realClear = window.clearTimeout.bind(window);
    window.setTimeout = ((fn: TimerHandler, ms?: number, ...args: unknown[]) => {
        if (typeof fn !== 'function') {
            return realSet(fn, ms, ...args);
        }
        const id: number = realSet(() => {
            const run = (): void => {
                if (!gate.cancelled.delete(id)) {
                    fn(...args);
                }
            };
            if (gate.closed) {
                gate.queued.push(run);
            } else {
                run();
            }
        }, ms);
        return id;
    }) as typeof window.setTimeout;
    window.clearTimeout = ((id?: number) => {
        if (gate.queued.length) {
            gate.cancelled.add(id);
        }
        realClear(id);
    }) as typeof window.clearTimeout;
}, TIMER_GATE);

/** Opens (`closed = false`) or closes the timer gate; opening runs the timers that came due meanwhile. */
const setTimerGate = (page: Page, closed: boolean): Promise<void> => page.evaluate(([key, close]) => {
    const gate = (window as unknown as Record<string, { closed: boolean; queued: Array<() => void> } | undefined>)[key];
    if (gate) {
        gate.closed = close;
        if (!close) {
            gate.queued.splice(0).forEach(run => run());
        }
    }
}, [TIMER_GATE, closed] as const);

const seenLabels = (page: Page): Promise<string[]> => page.evaluate(key => [...(window as unknown as Record<string, string[]>)[key] ?? []], SEEN_GLOBAL);

/**
 * Waits (every frame) for a label and screenshots at once: quick steps stay up only for the line's hold time
 * (450 ms). Animations are stopped for the shot, so the fade-in is complete and the text rests on its base color.
 */
const captureLabel = async (page: Page, label: string, name: string): Promise<void> => {
    // The gate closes in the same frame the label is seen, before the line's hold can run out.
    await page.waitForFunction(([selector, text, key]) => {
        const shown = document.querySelector(selector)?.textContent === text;
        const gate = (window as unknown as Record<string, { closed: boolean } | undefined>)[key];
        if (shown && gate) {
            gate.closed = true;
        }
        return shown;
    }, [LABEL, label, TIMER_GATE] as const, { polling: 'raf', timeout: STEP_TIMEOUT });
    try {
        if (SHOTS_DIR) {
            fs.mkdirSync(SHOTS_DIR, { recursive: true });
            await page.screenshot({ path: path.join(SHOTS_DIR, name), animations: 'disabled' });
            // Read the DOM directly: a locator would wait for a line that already went away.
            const after = await page.evaluate(selector => document.querySelector(selector)?.textContent ?? '', LABEL);
            if (after !== label) {
                fs.appendFileSync(path.join(SHOTS_DIR, SHOT_NOTES), `${name}: the line moved on to "${after}" during the shot\n`);
            }
        }
    } finally {
        await setTimerGate(page, false);
    }
};

/** `expected` appears in `seen` in this order (other labels may sit between them). */
const inOrder = (seen: readonly string[], expected: readonly string[]): boolean => {
    let at = 0;
    for (const label of seen) {
        if (label === expected[at]) {
            at++;
        }
    }
    return at === expected.length;
};

const PLAN_PROMPT = 'plan a discount for the cart';
const PLAN = ['PLAN:', '- Add the discount helper in `src/discount.ts`', '- Use it for the cart total', '', 'Low risk.'].join('\n');
const BUILD = `Building it.\n\n<<<EDIT src/discount.ts\nexport const discount = (cents: number): number => Math.round(cents * 0.9);\n>>>END\n`;

/** A small cart project whose `npm test` takes a few seconds, like a real test run. */
const makeProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-live-status-')));
    const slowTest = `node -e "setTimeout(() => console.log('3 passed'), ${TEST_SECONDS * 1_000})"`;
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'cart', private: true, scripts: { test: slowTest } }, undefined, 2));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'cart.ts'), LONG_LINE.repeat(400));
    fs.writeFileSync(path.join(dir, 'src', 'totals.ts'), 'export const total = (): number => 0;\n');
    fs.writeFileSync(path.join(dir, 'src', 'App.tsx'), APP);
    return dir;
};

test.describe('Agent live status line', () => {
    test.setTimeout(240_000);
    const dirs: string[] = [];
    let server: FakeOllama;

    test.beforeEach(async () => {
        server = await startFakeOllama((_system, user) => replyFor(user), STREAM);
    });

    test.afterEach(async () => {
        await server.close();
        dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
    });

    test('follows the real steps of a run in light and dark, and keeps still for reduced motion', async ({ page }) => {
        dirs.push(makeProject());
        await openIngot(page, dirs[0]);
        await openSettingsPage(page, 'appearance');
        const appearance = await page.locator('#ingot-setting-ingot-appearance').inputValue();
        await page.locator('#ingot-settings-cancel').click();
        const composer = page.locator('#ingot-composer-input');
        const working = page.locator('#ingot-chat-working');
        const text = page.locator(LABEL);
        try {
            await connectOllama(page, server);
            for (const theme of ['light', 'dark'] as const) {
                // Each theme runs in a fresh project, so nothing of the last run (review, checks) carries over.
                if (theme !== 'light') {
                    dirs.push(makeProject());
                    await openIngot(page, dirs[dirs.length - 1]);
                }
                await setAppearance(page, theme);
                await page.locator('#ingot-agents-new').click();
                await pickModel(page, 'ollama-local');
                await dismissNotifications(page);
                await recordLabels(page);
                await composer.fill(PROMPT);
                await composer.press('Enter');

                // Before the first token: "Thinking…" with three pulsing dots, shimmering like every line.
                await captureLabel(page, 'Thinking…', `status-thinking-${theme}.png`);
                const dots = page.locator('#ingot-chat-typing i');
                await expect(dots).toHaveCount(3);
                await expect(dots.first()).toHaveCSS('animation-name', 'ingot-typing-dot');
                await expect(text).toHaveCSS('animation-name', 'ingot-shimmer-sweep');
                await expect(page.locator('#ingot-chat-working .ingot-live-status-in')).toHaveCSS('animation-name', 'ingot-live-status-in');

                await captureLabel(page, 'Typing…', `status-typing-${theme}.png`);
                await expect(page.locator('#ingot-chat-typing')).toHaveCount(0);
                await captureLabel(page, 'Searching the codebase…', `status-searching-${theme}.png`);
                await captureLabel(page, 'Reading 3 files…', `status-reading-${theme}.png`);

                // The test command waits on the approval card (the line steps aside), then runs for a few seconds.
                await page.locator('#ingot-approval-run').click({ timeout: STEP_TIMEOUT });
                await captureLabel(page, 'Running tests…', `status-running-tests-${theme}.png`);
                await captureLabel(page, 'Editing App.tsx…', `status-editing-${theme}.png`);
                await captureLabel(page, 'Almost there…', `status-almost-there-${theme}.png`);
                await expect(working).toHaveCount(0, { timeout: STEP_TIMEOUT });
                await expect(page.locator('#ingot-agents .ingot-chat-agent .ingot-md').last()).toContainText('rounds once at the end');

                const seen = await seenLabels(page);
                expect(seen, seen.join(' | ')).toContain('Thinking… [dots]');
                expect(inOrder(seen, [
                    'Thinking… [dots]', 'Typing…', 'Searching the codebase…', 'Reading 3 files…', 'Running tests…', 'Editing App.tsx…', 'Typing…', 'Almost there…'
                ]), seen.join(' | ')).toBe(true);
                // Only real steps: no label outside the run's own steps.
                const known = /^(Getting it done…|Thinking… \[dots\]|Typing…|Searching the codebase…|Reading 3 files…|Running tests…|Editing App\.tsx…|Almost there…)$/;
                expect(seen.filter(label => !known.test(label)), seen.join(' | ')).toEqual([]);
            }

            // Reduced motion: the dots and the line keep still, and the text is plain muted text.
            await page.emulateMedia({ reducedMotion: 'reduce' });
            await composer.fill(PLAIN_PROMPT);
            await composer.press('Enter');
            await page.waitForFunction(selector => document.querySelector(selector)?.textContent === 'Thinking…', LABEL, { polling: 'raf', timeout: STEP_TIMEOUT });
            await expect(page.locator('#ingot-chat-typing i').first()).toHaveCSS('animation-name', 'none');
            await expect(page.locator('#ingot-chat-working .ingot-live-status-in')).toHaveCSS('animation-name', 'none');
            await expect(text).toHaveCSS('animation-name', 'none');
            await expect(text).not.toHaveCSS('color', 'rgba(0, 0, 0, 0)');
            await expect(working).toHaveCount(0, { timeout: STEP_TIMEOUT });
        } finally {
            await page.emulateMedia({ reducedMotion: 'no-preference' });
            if (await page.locator('#ingot-settings').isVisible()) {
                await page.locator('#ingot-settings-cancel').click();
            }
            await openSettingsPage(page, 'appearance');
            await page.locator('#ingot-setting-ingot-appearance').selectOption(appearance);
            await page.locator('#ingot-settings-ok').click();
        }
    });
});

test.describe('Agent live status line: plan checks', () => {
    test.setTimeout(240_000);
    const dirs: string[] = [];
    let server: FakeOllama;

    test.beforeEach(async () => {
        server = await startFakeOllama((_system, user) => user.startsWith(PLAN_PROMPT) ? PLAN : BUILD, STREAM);
    });

    test.afterEach(async () => {
        await server.close();
        dirs.splice(0).forEach(dir => fs.rmSync(dir, { recursive: true, force: true }));
    });

    test('says "Checking the plan…" while a plan is checked, and again when Build\'s diff is checked against it', async ({ page }) => {
        dirs.push(makeProject());
        await openIngot(page, dirs[0]);
        await openSettingsPage(page, 'appearance');
        const appearance = await page.locator('#ingot-setting-ingot-appearance').inputValue();
        await page.locator('#ingot-settings-cancel').click();
        const composer = page.locator('#ingot-composer-input');
        try {
            await connectOllama(page, server);
            for (const theme of ['light', 'dark'] as const) {
                await setAppearance(page, theme);
                await page.locator('#ingot-agents-new').click();
                await pickModel(page, 'ollama-local');
                await dismissNotifications(page);
                await pickMode(page, 'plan');
                await recordLabels(page);
                await composer.fill(PLAN_PROMPT);
                await composer.press('Enter');
                // The plan is checked against the project's locked decisions before it is offered.
                await captureLabel(page, 'Checking the plan…', `status-checking-plan-${theme}.png`);
                await expect(page.locator('#ingot-plan-build')).toBeVisible({ timeout: STEP_TIMEOUT });
                await expect(page.locator('#ingot-chat-working')).toHaveCount(0, { timeout: STEP_TIMEOUT });
                expect(inOrder(await seenLabels(page), ['Thinking… [dots]', 'Typing…', 'Checking the plan…'])).toBe(true);
            }

            // Build: when the run ends, its diff is checked against the approved plan.
            await recordLabels(page);
            await page.locator('#ingot-plan-build').click();
            await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('Building it.', { timeout: STEP_TIMEOUT });
            await expect(page.locator('#ingot-agents').getByText('Checked against plan').first()).toBeVisible({ timeout: STEP_TIMEOUT });
            // The note lands when the check ends; the line may still be holding "Almost there…" for a moment.
            await expect.poll(async () => inOrder(await seenLabels(page), ['Editing discount.ts…', 'Almost there…', 'Checking the plan…']),
                { timeout: STEP_TIMEOUT }).toBe(true);
            await expect(page.locator('#ingot-chat-working')).toHaveCount(0, { timeout: STEP_TIMEOUT });
        } finally {
            if (await page.locator('#ingot-settings').isVisible()) {
                await page.locator('#ingot-settings-cancel').click();
            }
            await openSettingsPage(page, 'appearance');
            await page.locator('#ingot-setting-ingot-appearance').selectOption(appearance);
            await page.locator('#ingot-settings-ok').click();
        }
    });
});
