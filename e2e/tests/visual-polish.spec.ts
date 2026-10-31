import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot, runCommand } from '../src/app.utils';
import { makeToolsProject, setAppearance, SHOTS_DIR } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/**
 * Visual polish pass: the IDE chrome (title bar, activity bar, status bar), the idle agent panel and composer, the
 * settings pages (AI Models, User Rules, Habits, Agent approvals), Models, the sandbox menu, the Agent Manager and the
 * welcome screen share one radius scale, one control height and token colors in light and dark.
 * INGOT_SHOTS=<dir> saves each of them for before / after comparison.
 */
const SCHEMES = ['light', 'dark'] as const;
const NO_FOLDER = '!empty';
const SETTINGS_PAGES = ['ai', 'user-rules', 'habits', 'agent-approvals'] as const;
/** The one radius scale of the agent panel and settings controls (tokens.css). */
const RADII = ['3px', '4px', '6px', '8px', '10px'];
const CONTROL_HEIGHT = 28;

const save = async (page: Page, name: string, target?: Locator): Promise<void> => {
    if (!SHOTS_DIR) {
        return;
    }
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    await page.mouse.move(0, 0);
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    const file = path.join(SHOTS_DIR, name);
    await (target ?? page).screenshot({ path: file, animations: 'disabled' });
};

/** The left tool window stripe (activity bar), full height. */
const saveStripe = async (page: Page, name: string): Promise<void> => {
    const clip = await page.evaluate(() => {
        const bar = document.querySelector('.lm-TabBar.theia-app-left') ?? document.querySelector('#ingot-stripe-settings')?.parentElement;
        const r = bar?.getBoundingClientRect();
        return r && { x: r.left, y: r.top, width: Math.max(r.width, 1), height: Math.max(r.height, 1) };
    });
    if (SHOTS_DIR && clip) {
        await page.screenshot({ path: path.join(SHOTS_DIR, name), clip, animations: 'disabled' });
    }
};

const radius = (locator: Locator): Promise<string> => locator.evaluate(el => getComputedStyle(el).borderTopLeftRadius);

const openSettings = async (page: Page, id: string): Promise<Locator> => {
    const dialog = page.locator('#ingot-settings');
    if (!await dialog.isVisible()) {
        await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), dialog);
    }
    await page.locator(`#ingot-settings-node-${id}`).click();
    return dialog;
};

test.describe('visual polish', () => {
    test.setTimeout(240_000);
    let home: string;
    let server: FakeOllama;

    test.beforeEach(async () => {
        home = makeToolsProject('ingot-polish-');
        server = await startFakeOllama(() => 'Done.', { delayMs: 0 });
    });

    test.afterEach(async () => {
        await server.close();
        fs.rmSync(home, { recursive: true, force: true });
    });

    test('chrome, idle panel, settings pages, Models, sandbox menu and Agent Manager in light and dark', async ({ page }) => {
        await page.setViewportSize({ width: 1440, height: 900 });
        await openIngot(page, home);
        await dismissNotifications(page);
        await connectOllama(page, server);
        const modelsTab = page.locator('#theia-main-content-panel .lm-TabBar-tab', { hasText: 'Models' }).first();
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');

        for (const scheme of SCHEMES) {
            await setAppearance(page, scheme);
            await expect(page.locator('body')).toHaveClass(new RegExp(`ingot-${scheme}`));
            await dismissNotifications(page);

            // Models page in the editor area.
            await runCommand(page, 'Ingot: Models');
            await expect(page.locator('#ingot-models')).toBeVisible();
            await save(page, `models-${scheme}.png`);
            await modelsTab.click({ button: 'middle' });
            await expect(page.locator('#ingot-models')).toHaveCount(0);

            // Whole window with the idle panel, then the title bar, activity bar, status bar and panel alone.
            const panel = page.locator('.ingot-agents');
            await expect(panel).toBeVisible();
            await save(page, `window-${scheme}.png`);
            await save(page, `titlebar-${scheme}.png`, page.locator('.ingot-tb'));
            await saveStripe(page, `activity-bar-${scheme}.png`);
            await save(page, `statusbar-${scheme}.png`, page.locator('#theia-statusBar'));
            await save(page, `agent-idle-${scheme}.png`, panel);

            // Composer card, send and pills follow the radius scale and the control height.
            const composer = page.locator('.ingot-agents .ingot-composer');
            expect.soft(RADII).toContain(await radius(composer));
            expect.soft(RADII).toContain(await radius(page.locator('#ingot-composer-send')));
            expect.soft(RADII).toContain(await radius(page.locator('#ingot-composer-mode')));

            // Sandbox menu from the composer.
            await page.locator('#ingot-composer-sandbox').click();
            const sandbox = page.locator('.ingot-sandbox-menu');
            await expect(sandbox).toBeVisible();
            expect.soft(RADII).toContain(await radius(sandbox));
            await save(page, `sandbox-menu-${scheme}.png`, panel);
            await page.keyboard.press('Escape');
            await expect(sandbox).toBeHidden();

            // Settings pages.
            for (const id of SETTINGS_PAGES) {
                const dialog = await openSettings(page, id);
                await expect(page.locator(`#ingot-settings-page-${id}`)).toBeVisible();
                await save(page, `settings-${id}-${scheme}.png`, dialog);
            }
            const dialog = page.locator('#ingot-settings');
            for (const button of ['#ingot-settings-ok', '#ingot-settings-cancel']) {
                expect.soft(Math.round((await page.locator(button).boundingBox())!.height)).toBe(CONTROL_HEIGHT);
                expect.soft(RADII).toContain(await radius(page.locator(button)));
            }
            await page.locator('#ingot-settings-cancel').click();
            await expect(dialog).toBeHidden();

            // Agent Manager.
            const manager = page.locator('#ingot-agent-manager');
            await actUntilVisible(() => page.keyboard.press('Control+Alt+Shift+M'), manager);
            await save(page, `agent-manager-${scheme}.png`);
            await actUntilVisible(() => page.keyboard.press('Control+Alt+Shift+M'), page.locator('#ingot-agents'));
        }
    });

    for (const scheme of SCHEMES) {
        test(`welcome screen (${scheme})`, async ({ page }) => {
            await openIngot(page, home);
            await setAppearance(page, scheme);
            await openIngot(page, NO_FOLDER);
            const welcome = page.locator('#ingot-welcome');
            await expect(welcome).toBeVisible();
            await expect(page.locator('body')).toHaveClass(new RegExp(`ingot-${scheme}`));
            const cards = welcome.locator('.ingot-welcome-card');
            await expect(cards).toHaveCount(3);
            expect.soft(RADII).toContain(await radius(cards.first()));
            await save(page, `welcome-${scheme}.png`);
        });
    }
});
