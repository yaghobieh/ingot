import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickMode, pickModel } from '../src/chat.e2e-utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import { HABITS_PAGE, currentAppearance, disableHabits, enableHabits, openSettingsPage, resetAutopilotSettings, setSettings } from '../src/autopilot.e2e-utils';

/**
 * IDEA-306 Plan-Diff Review: Build saves the approved plan to .ingot/plans/; after the run the diff is checked against
 * its steps (matched, missing, out-of-scope files) in a review card with a silver "Checked against plan" note. Approved
 * plans teach Habits a plan template per task type, used in the next Plan-mode prompt.
 */
const PLAN = [
    'PLAN:',
    '- Add the discount helper in `src/cart/discount.ts`',
    '- Apply the discount in the cart view',
    '- Document the discount in README.md',
    '',
    'Low risk.'
].join('\n');
const BUILD = [
    'Building it.',
    '',
    '<<<EDIT src/cart/discount.ts',
    'export const discount = (cents: number, percent: number): number => Math.round(cents * (100 - percent) / 100);',
    '>>>END',
    '',
    '<<<EDIT src/cart/view.ts',
    "import { discount } from './discount';",
    'export const label = (cents: number): string => `${discount(cents, 10)} cents`;',
    '>>>END',
    '',
    '<<<EDIT src/debug/trace.ts',
    'export const trace = (text: string): void => console.log(text);',
    '>>>END',
    ''
].join('\n');

const makeProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-plan-review-')));
    fs.mkdirSync(path.join(dir, 'src', 'cart'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'cart', 'view.ts'), 'export const label = (cents: number): string => `${cents} cents`;\n');
    fs.writeFileSync(path.join(dir, 'README.md'), '# Shop\n');
    return dir;
};

const composer = (page: Page) => page.locator('#ingot-composer-input');
const agents = (page: Page) => page.locator('#ingot-agents');
const plans = (dir: string): string[] => {
    const folder = path.join(dir, '.ingot', 'plans');
    return fs.existsSync(folder) ? fs.readdirSync(folder).filter(f => f.endsWith('.md')).sort() : [];
};

/** Asks for a plan once the previous run (with its follow-up checks) has finished. */
const askPlan = async (page: Page, server: FakeOllama, request: string): Promise<void> => {
    await expect(page.locator('#ingot-composer-stop')).toHaveCount(0, { timeout: 60_000 });
    await pickMode(page, 'plan');
    await composer(page).fill(request);
    await composer(page).press('Enter');
    await expect.poll(() => server.requests.some(r => r.user.startsWith(request) && r.system.includes('implementation plan')), { timeout: 60_000 }).toBe(true);
    await expect(page.locator('#ingot-plan-build')).toBeVisible({ timeout: 60_000 });
    await expect(agents(page).locator('.ingot-chat-plan').last()).toContainText('Apply the discount in the cart view');
};

const planAndBuild = async (page: Page, server: FakeOllama, request: string): Promise<void> => {
    await askPlan(page, server, request);
    await page.locator('#ingot-plan-build').click();
    await expect(page.locator('#ingot-composer-more')).toHaveAttribute('data-mode', 'agent');
};

test.describe('IDEA-306 Plan-Diff Review', () => {
    test.setTimeout(300_000);
    let dir: string;
    let server: FakeOllama;

    test.beforeEach(async () => {
        resetAutopilotSettings();
        dir = makeProject();
        server = await startFakeOllama((system, user) => {
            if (user.startsWith('Implement the plan')) {
                return BUILD;
            }
            return system.includes('implementation plan') ? PLAN : 'Plain answer.';
        }, { delayMs: 0 });
    });

    test.afterEach(async () => {
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
        resetAutopilotSettings();
    });

    test('Build saves the plan, the diff is checked against it, and approved plans become a template', async ({ page }) => {
        await openIngot(page, dir);
        await dismissNotifications(page);
        const appearance = await currentAppearance(page);
        try {
            await enableHabits(page, '2');
            await setAppearance(page, 'dark');
            await connectOllama(page, server);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            await dismissNotifications(page);

            await planAndBuild(page, server, 'Add a cart discount');
            const card = agents(page).locator('.ingot-plan-review').last();
            await expect(card).toBeVisible({ timeout: 60_000 });
            await expect(card).toHaveAttribute('data-matched', '2');
            await expect(card).toHaveAttribute('data-total', '3');
            await expect(card.locator('.ingot-plan-review-summary')).toHaveText('2 of 3 steps matched · 1 out-of-scope file');
            const steps = card.locator('.ingot-plan-review-step');
            await expect(steps.nth(0)).toHaveAttribute('data-state', 'matched');
            await expect(steps.nth(0)).toContainText('src/cart/discount.ts');
            await expect(steps.nth(1)).toHaveAttribute('data-state', 'matched');
            await expect(steps.nth(1)).toContainText('src/cart/view.ts');
            await expect(steps.nth(2)).toHaveAttribute('data-state', 'missing');
            await expect(card.locator('.ingot-plan-review-file')).toHaveText(['src/debug/trace.ts']);
            const note = agents(page).locator('.ingot-habit-note-plan').last();
            await expect(note).toContainText('Checked against plan');
            await expect(note).toContainText('2 of 3 steps matched');
            await shot(page, 'IDEA-306-review-dark.png');

            // The approved plan is saved with the review appended.
            expect(plans(dir)).toHaveLength(1);
            const planFile = fs.readFileSync(path.join(dir, '.ingot', 'plans', plans(dir)[0]), 'utf8');
            expect(planFile).toContain('Request: Add a cart discount');
            expect(planFile).toContain('2. Apply the discount in the cart view');
            await expect.poll(() => fs.readFileSync(path.join(dir, '.ingot', 'plans', plans(dir)[0]), 'utf8')).toContain('- [ ] Document the discount in README.md (missing)');
            expect(fs.readFileSync(path.join(dir, '.ingot', 'plans', plans(dir)[0]), 'utf8')).toContain('Out of scope:\n- `src/debug/trace.ts`');

            // "Open plan" opens the saved plan in the editor.
            await note.locator('.ingot-habit-note-action').click();
            await expect(page.locator('.monaco-editor .view-lines').first()).toContainText('taskType: feature');

            // A second approved plan of the same task type is saved to Habits as a template.
            await planAndBuild(page, server, 'Add a cart coupon');
            await expect(agents(page).locator('.ingot-plan-review')).toHaveCount(2, { timeout: 60_000 });
            const saved = agents(page).locator('.ingot-habit-note-habit');
            await expect(saved).toContainText('Saved to Habits');
            await expect(saved).toContainText('Plan template for');
            const template = path.join(dir, '.ingot', 'plans', 'templates', 'feature.md');
            await expect.poll(() => fs.existsSync(template)).toBe(true);
            expect(fs.readFileSync(template, 'utf8')).toContain('1. Add the discount helper in <file>');
            await setAppearance(page, 'light');
            await shot(page, 'IDEA-306-review-light.png');

            // The next Plan-mode prompt of that type is shaped by the template.
            await askPlan(page, server, 'Add a wishlist');
            const planned = server.requests.find(r => r.user.startsWith('Add a wishlist') && r.system.includes('implementation plan'));
            expect(planned?.system).toContain('Plan template the user approved before for feature tasks');
            expect(planned?.system).toContain('- Add the discount helper in <file>');
            const first = server.requests.find(r => r.user.startsWith('Add a cart discount') && r.system.includes('implementation plan'));
            expect(first).toBeDefined();
            expect(first?.system).not.toContain('Plan template the user approved before');

            await openSettingsPage(page, HABITS_PAGE);
            await expect(page.locator('#ingot-learned-habits [data-learned="plan-template:feature"]')).toContainText('saved');
            await page.locator('#ingot-learned-habits').scrollIntoViewIfNeeded();
            await shot(page, 'IDEA-306-habits-page-light.png');
            await page.locator('#ingot-settings-cancel').click();
        } finally {
            await disableHabits(page);
            await setSettings(page, 'appearance', { 'ingot.appearance': appearance });
        }
    });
});
