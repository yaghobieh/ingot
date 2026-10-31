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
 * IDEA-296: when Habits learns or saves a pattern, a small silver "Saved to Habits" note shows in the agent chat. It opens
 * the habit on the Habits page and has Undo (a saved rule file is deleted, a learned pattern is forgotten).
 */
const HABIT_ID = 'instruction-use-bear-components';
const RULE = '.ingot/rules/use-bear-components.md';
const LEARNING = {
    version: 1,
    habits: [{
        id: HABIT_ID, kind: 'instruction', key: 'instruction:use bear components', label: 'use Bear components', text: 'Use Bear components.',
        count: 2, examples: ['use Bear components'], enabled: true, status: 'learning', firstSeen: 1, lastSeen: 2
    }]
};

const makeProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-habit-note-')));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({ name: 'shop', private: true }, undefined, 2));
    fs.mkdirSync(path.join(dir, '.ingot'), { recursive: true });
    fs.writeFileSync(path.join(dir, '.ingot', 'habits.json'), JSON.stringify(LEARNING, undefined, 2));
    return dir;
};

const habitsFile = (dir: string): { habits: { id: string; status: string; savedAs?: string }[] } =>
    JSON.parse(fs.readFileSync(path.join(dir, '.ingot', 'habits.json'), 'utf8')) as { habits: { id: string; status: string; savedAs?: string }[] };

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

test.describe('IDEA-296 "Saved to Habits" note in the agent chat', () => {
    test.setTimeout(180_000);
    let dir: string;
    let server: FakeOllama;

    test.beforeEach(async () => {
        dir = makeProject();
        server = await startFakeOllama(() => 'Done.', { delayMs: 0 });
    });

    test.afterEach(async () => {
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('learned and saved notes open the habit on the Habits page and undo', async ({ page }) => {
        await openIngot(page, dir);
        const appearance = await currentAppearance(page);
        await openSettingsPage(page, 'habits');
        await page.locator('#ingot-habits-enabled').check();
        await page.locator('#ingot-settings-cancel').click();
        try {
            await setAppearance(page, 'dark');
            await connectOllama(page, server);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            await dismissNotifications(page);

            // The third "use Bear components" teaches Habits the pattern: a learned note.
            const composer = page.locator('#ingot-composer-input');
            await composer.fill('use Bear components');
            await composer.press('Enter');
            const notes = page.locator('#ingot-agents .ingot-habit-note');
            const learned = notes.first();
            await expect(learned).toContainText('Saved to Habits');
            await expect(learned).toContainText('Learned: use Bear components');
            await expect(learned).toHaveAttribute('data-habit-note', `learned:${HABIT_ID}`);
            await expect(learned.locator('.codicon-checklist')).toBeVisible();
            await expect(page.locator('#ingot-habit-cards .ingot-habit-card')).toContainText('You often ask to use Bear components.');
            await shot(page, 'habit-note-learned-dark.png');
            await setAppearance(page, 'light');
            await shot(page, 'habit-note-learned-light.png');

            // The note is quiet: muted text, no accent colors.
            const colors = await learned.evaluate(el => {
                const probe = document.createElement('span');
                probe.style.color = 'var(--ingot-text-muted)';
                el.appendChild(probe);
                const muted = getComputedStyle(probe).color;
                probe.remove();
                return { text: getComputedStyle(el).color, muted, size: getComputedStyle(el).fontSize };
            });
            expect(colors.text).toBe(colors.muted);
            expect(colors.size).toBe('11px');

            // Clicking it opens the Habits page on that pattern.
            await learned.locator('.ingot-habit-note-open').click();
            await expect(page.locator('#ingot-settings-page-habits')).toBeVisible();
            const row = page.locator(`#ingot-habits-manager [data-habit="${HABIT_ID}"]`);
            await expect(row).toHaveClass(/ingot-habit-highlight/);
            await expect(row).toBeInViewport();
            await expect(row).toContainText('3×');
            await shot(page, 'habit-note-opens-habits-page-light.png');
            await page.locator('#ingot-settings-cancel').click();

            // "Make it a rule" saves it: a second note with the file, the old "Saved to … OK" banner is gone.
            await page.locator('#ingot-habit-cards [data-target="rule"]').click();
            const saved = notes.nth(1);
            await expect(saved).toContainText(`use Bear components → ${RULE}`);
            await expect(page.locator('#ingot-habit-cards')).toHaveCount(0);
            expect(fs.existsSync(path.join(dir, RULE))).toBe(true);
            await shot(page, 'habit-note-saved-light.png');
            await setAppearance(page, 'dark');
            await shot(page, 'habit-note-saved-dark.png');

            // Undo the save: the rule file is deleted and the suggestion is back.
            await saved.locator('.ingot-habit-note-undo').click();
            await expect(saved).toContainText('Removed from Habits');
            await expect(saved.locator('.ingot-habit-note-undo')).toHaveCount(0);
            await expect.poll(() => fs.existsSync(path.join(dir, RULE))).toBe(false);
            await expect.poll(() => habitsFile(dir).habits[0]?.status).toBe('proposed');
            await expect(page.locator('#ingot-habit-cards .ingot-habit-card')).toBeVisible();
            await shot(page, 'habit-note-undone-dark.png');

            // Undo the learned note: Habits forgets the pattern.
            await learned.locator('.ingot-habit-note-undo').click();
            await expect(learned).toContainText('Removed from Habits');
            await expect.poll(() => habitsFile(dir).habits.length).toBe(0);
            await expect(page.locator('#ingot-habit-cards')).toHaveCount(0);
        } finally {
            if (await page.locator('#ingot-settings').isVisible()) {
                await page.locator('#ingot-settings-cancel').click();
            }
            await openSettingsPage(page, 'habits');
            await page.locator('#ingot-habits-enabled').uncheck();
            await page.locator('#ingot-settings-node-appearance').click();
            await page.locator('#ingot-setting-ingot-appearance').selectOption(appearance);
            await page.locator('#ingot-settings-ok').click();
        }
    });
});
