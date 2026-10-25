import { expect, type Locator, type Page } from '@playwright/test';
import { APP_READY_TIMEOUT_MS, E2E_BASE_URL, FIXTURE_WORKSPACE, QUICK_INPUT_LABEL, SHELL_SELECTOR } from './e2e.consts';

/** Opens Ingot on the fixture workspace and waits until the shell and workspace are ready. */
export const openIngot = async (page: Page): Promise<void> => {
    await page.goto(`${E2E_BASE_URL}/#${FIXTURE_WORKSPACE}`);
    await expect(page.locator(SHELL_SELECTOR)).toBeVisible({ timeout: APP_READY_TIMEOUT_MS });
    await expect(page.locator('.theia-preload')).toHaveCount(0, { timeout: APP_READY_TIMEOUT_MS });
};

export const quickInput = (page: Page): Locator => page.getByRole('textbox', { name: QUICK_INPUT_LABEL });
export const quickOptions = (page: Page): Locator => page.getByRole('listbox', { name: QUICK_INPUT_LABEL }).getByRole('option');

/** Runs a command through the command palette (F1), like a user would. */
export const runCommand = async (page: Page, label: string): Promise<void> => {
    await page.keyboard.press('F1');
    await expect(quickInput(page)).toBeVisible();
    await quickInput(page).fill(`>${label}`);
    await quickOptions(page).filter({ hasText: label }).first().click();
};

/**
 * Repeats a user action until the expected locator is visible. Theia finishes wiring commands and
 * keybindings asynchronously after the shell paints, so the first key press can arrive too early.
 */
export const actUntilVisible = async (action: () => Promise<void>, target: Locator, timeoutMs = 30_000): Promise<void> => {
    await expect(async () => {
        await action();
        await expect(target).toBeVisible({ timeout: 2_000 });
    }).toPass({ timeout: timeoutMs });
};

export const actUntilHidden = async (action: () => Promise<void>, target: Locator, timeoutMs = 30_000): Promise<void> => {
    await expect(async () => {
        await action();
        await expect(target).toBeHidden({ timeout: 2_000 });
    }).toPass({ timeout: timeoutMs });
};
