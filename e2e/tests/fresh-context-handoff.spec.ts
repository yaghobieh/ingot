import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot, runCommand } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import {
    AUTOPILOT_PAGE, HABITS_PAGE, currentAppearance, disableHabits, enableHabits, openSettingsPage, resetAutopilotSettings, setSettings
} from '../src/autopilot.e2e-utils';

/**
 * IDEA-305 Fresh-Context Auto-Handoff: after the turn limit the chat offers a fresh start; accepting writes a brief
 * (goal, plan, .ingot/decisions.md, diff, failures) to .ingot/handoffs/ and continues in a new chat seeded with it.
 * Accepted handoffs teach Habits the turn count ("Saved to Habits"), shown as silver notes in the chat.
 */
const BRIEF_START = 'You are taking over from an earlier agent chat';

const makeProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-fresh-')));
    fs.mkdirSync(path.join(dir, 'src'), { recursive: true });
    fs.mkdirSync(path.join(dir, '.ingot'), { recursive: true });
    fs.writeFileSync(path.join(dir, 'src', 'cart.ts'), 'export const total = (items: number[]): number => items.reduce((a, b) => a + b, 0);\n');
    fs.writeFileSync(path.join(dir, '.ingot', 'decisions.md'), '# Decisions\n\n- Money is kept in integer cents.\n');
    return dir;
};

const composer = (page: Page) => page.locator('#ingot-composer-input');
const agents = (page: Page) => page.locator('#ingot-agents');
const lastReply = (page: Page) => agents(page).locator('.ingot-chat-agent .ingot-md').last();
const activeTab = (page: Page) => agents(page).locator('.ingot-chat-tab.active .ingot-chat-tab-title');

const send = async (page: Page, text: string, reply: string): Promise<void> => {
    await composer(page).fill(text);
    await composer(page).press('Enter');
    await expect(lastReply(page)).toContainText(reply, { timeout: 60_000 });
};

const handoffs = (dir: string): string[] => {
    const folder = path.join(dir, '.ingot', 'handoffs');
    return fs.existsSync(folder) ? fs.readdirSync(folder).filter(f => f.endsWith('.md')).sort() : [];
};

test.describe('IDEA-305 Fresh-Context Auto-Handoff', () => {
    test.setTimeout(300_000);
    let dir: string;
    let server: FakeOllama;

    test.beforeEach(async () => {
        resetAutopilotSettings();
        dir = makeProject();
        server = await startFakeOllama((_system, user) => {
            if (user.includes(BRIEF_START)) {
                return 'Picked up from the brief.';
            }
            if (user.startsWith('Make the cart total use cents')) {
                return 'Switching to cents.\n\n<<<EDIT src/cart.ts\nexport const total = (cents: number[]): number => cents.reduce((a, b) => a + b, 0);\n>>>END\n';
            }
            return `Done: ${user.slice(0, 30)}`;
        }, { delayMs: 0 });
    });

    test.afterEach(async () => {
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
        resetAutopilotSettings();
    });

    test('a long chat offers a fresh start; the brief is saved and seeds the new chat; Habits learns the turn count', async ({ page }) => {
        await openIngot(page, dir);
        await dismissNotifications(page);
        const appearance = await currentAppearance(page);
        try {
            await setSettings(page, AUTOPILOT_PAGE, { 'ingot.agent.freshContext.mode': 'offer', 'ingot.agent.freshContext.turns': '3' });
            await enableHabits(page, '2');
            await setAppearance(page, 'dark');
            await connectOllama(page, server);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            await dismissNotifications(page);

            // Three turns: the offer shows once the turn limit is reached, not before.
            await send(page, 'Make the cart total use cents', 'Switching to cents.');
            await send(page, 'Round the tax to whole cents', 'Done: Round the tax');
            await expect(page.locator('#ingot-handoff-offer')).toHaveCount(0);
            await send(page, 'Show the total in the footer', 'Done: Show the total');
            const offer = page.locator('#ingot-handoff-offer');
            await expect(offer).toContainText('3 turns');
            await expect(offer).toContainText('Continue in a fresh chat');
            await shot(page, 'IDEA-305-offer-dark.png');

            await page.locator('#ingot-handoff-accept').click();
            await expect(activeTab(page)).toContainText('(fresh)');
            await expect(lastReply(page)).toContainText('Picked up from the brief.', { timeout: 60_000 });
            const note = agents(page).locator('.ingot-habit-note-handoff').first();
            await expect(note).toContainText('Fresh context - handed off');
            await expect(note).toContainText('3 turns');
            await expect(agents(page).locator('.ingot-chat-user').last()).toContainText('Continue from the handoff brief.');

            // The brief: goal, decisions, the diff so far; the new chat's model got it as its first turn.
            expect(handoffs(dir)).toHaveLength(1);
            const brief = fs.readFileSync(path.join(dir, '.ingot', 'handoffs', handoffs(dir)[0]), 'utf8');
            expect(brief).toContain('## Goal\n\nMake the cart total use cents');
            expect(brief).toContain('## Latest request\n\nShow the total in the footer');
            expect(brief).toContain('Money is kept in integer cents.');
            expect(brief).toContain('`src/cart.ts`');
            expect(brief).toContain('+export const total = (cents: number[])');
            expect(brief).toContain('## Where it stopped\n\nDone: Show the total');
            const seeded = server.requests.find(r => r.user.includes(BRIEF_START))!;
            expect(seeded.user).toContain('Money is kept in integer cents.');
            expect(seeded.user).toContain('Continue from the handoff brief.');
            expect(seeded.users).toHaveLength(1);
            await shot(page, 'IDEA-305-fresh-chat-dark.png');

            // Second handoff through Find Action: two accepted handoffs at 3 turns are saved to Habits.
            await send(page, 'Check the totals again', 'Done: Check the totals');
            await send(page, 'And the receipts', 'Done: And the receipts');
            await expect(page.locator('#ingot-handoff-offer')).toContainText('3 turns');
            await setAppearance(page, 'light');
            await shot(page, 'IDEA-305-offer-light.png');
            await runCommand(page, 'Agents: Hand Off to a Fresh Chat');
            await expect(agents(page).locator('.ingot-habit-note-handoff').first()).toContainText(/from ".+ \(fresh\)"/);
            await expect(activeTab(page)).toHaveText(/\(fresh\)$/);
            await expect(activeTab(page)).not.toContainText('(fresh) (fresh)');
            await expect(lastReply(page)).toContainText('Picked up from the brief.', { timeout: 60_000 });
            const saved = agents(page).locator('.ingot-habit-note-habit');
            await expect(saved).toContainText('Saved to Habits');
            await expect(saved).toContainText('Hand off to a fresh chat after 3 turns');
            expect(handoffs(dir)).toHaveLength(2);
            await shot(page, 'IDEA-305-saved-to-habits-light.png');

            const learned = JSON.parse(fs.readFileSync(path.join(dir, '.ingot', 'habits-learned.json'), 'utf8')) as { learned: { id: string; status: string; value?: string }[] };
            expect(learned.learned.find(h => h.id === 'handoff-turns')).toMatchObject({ status: 'saved', value: '3' });
            await openSettingsPage(page, HABITS_PAGE);
            await expect(page.locator('#ingot-learned-habits [data-learned="handoff-turns"]')).toContainText('Hand off to a fresh chat after 3 turns');
            await page.locator('#ingot-learned-habits').scrollIntoViewIfNeeded();
            await shot(page, 'IDEA-305-habits-page-light.png');
            await page.locator('#ingot-settings-cancel').click();
        } finally {
            await disableHabits(page);
            await setSettings(page, AUTOPILOT_PAGE, { 'ingot.agent.freshContext.turns': '12' });
            await setSettings(page, 'appearance', { 'ingot.appearance': appearance });
        }
    });
});
