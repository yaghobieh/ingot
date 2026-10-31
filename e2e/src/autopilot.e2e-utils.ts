import * as fs from 'fs';
import * as path from 'path';
import { expect, type Page } from '@playwright/test';
import { actUntilVisible } from './app.utils';
import { E2E_CONFIG_DIR } from './e2e.consts';

/** IDEA-305..307 e2e helpers: settings through the Settings dialog, Habits on / off, and a clean e2e profile afterwards. */
export const AUTOPILOT_PAGE = 'agent-autopilot';
export const HABITS_PAGE = 'habits';
export const DEFAULT_HABITS_THRESHOLD = '3';

const SETTINGS_FILE = path.join(E2E_CONFIG_DIR, 'settings.json');
const AUTOPILOT_KEYS = [
    'ingot.agent.freshContext.mode', 'ingot.agent.freshContext.turns', 'ingot.agent.freshContext.failures', 'ingot.agent.freshContext.tokenRatio',
    'ingot.agent.cost.forecast', 'ingot.agent.cost.warnUsd', 'ingot.agent.router.enabled', 'ingot.habits.enabled', 'ingot.habits.threshold'
];

const settingId = (key: string): string => `#ingot-setting-${key.replace(/[^a-zA-Z0-9]+/g, '-')}`;

export const openSettingsPage = async (page: Page, id: string): Promise<void> => {
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), page.locator('#ingot-settings'));
    await page.locator(`#ingot-settings-node-${id}`).click();
};

/** Sets settings on one page of the Settings dialog with real clicks and typing, then OK. */
export const setSettings = async (page: Page, pageId: string, values: Record<string, string | boolean>): Promise<void> => {
    await openSettingsPage(page, pageId);
    for (const [key, value] of Object.entries(values)) {
        const control = page.locator(settingId(key));
        if (typeof value === 'boolean') {
            await control.setChecked(value);
        } else if (await control.evaluate(el => el.tagName === 'SELECT')) {
            await control.selectOption(value);
        } else {
            await control.fill(value);
        }
    }
    await page.locator('#ingot-settings-ok').click();
    await expect(page.locator('#ingot-settings')).toBeHidden();
};

/** Settings › Habits: "Learn habits" on, saved after `threshold` matching choices. */
export const enableHabits = async (page: Page, threshold: string): Promise<void> => {
    await openSettingsPage(page, HABITS_PAGE);
    await page.locator('#ingot-habits-enabled').check();
    await page.locator(settingId('ingot.habits.threshold')).fill(threshold);
    await page.locator('#ingot-settings-ok').click();
    await expect(page.locator('#ingot-settings')).toBeHidden();
};

export const disableHabits = async (page: Page): Promise<void> => {
    if (await page.locator('#ingot-settings').isVisible()) {
        await page.locator('#ingot-settings-cancel').click();
    }
    await openSettingsPage(page, HABITS_PAGE);
    await page.locator('#ingot-habits-enabled').uncheck();
    await page.locator(settingId('ingot.habits.threshold')).fill(DEFAULT_HABITS_THRESHOLD);
    await page.locator('#ingot-settings-ok').click();
    await expect(page.locator('#ingot-settings')).toBeHidden();
};

export const currentAppearance = async (page: Page): Promise<string> => {
    await openSettingsPage(page, 'appearance');
    const value = await page.locator('#ingot-setting-ingot-appearance').inputValue();
    await page.locator('#ingot-settings-cancel').click();
    return value;
};

/** A spec that stopped half way must not leave these settings changed for the next spec. */
export const resetAutopilotSettings = (): void => {
    if (!fs.existsSync(SETTINGS_FILE)) {
        return;
    }
    try {
        const settings = JSON.parse(fs.readFileSync(SETTINGS_FILE, 'utf8')) as Record<string, unknown>;
        if (AUTOPILOT_KEYS.some(key => key in settings)) {
            AUTOPILOT_KEYS.forEach(key => delete settings[key]);
            fs.writeFileSync(SETTINGS_FILE, JSON.stringify(settings, undefined, 4));
        }
    } catch {
        // Not plain JSON: leave it to the app.
    }
};
