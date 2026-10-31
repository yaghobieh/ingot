import * as fs from 'fs';
import { expect, test } from '@playwright/test';
import { dismissNotifications, openIngot, runCommand } from '../src/app.utils';
import { setAppearance, shot } from '../src/agent-tools.e2e-utils';
import { LANGUAGE_FIXTURES, TOOLCHAIN_OVERRIDES_FILE } from '../src/e2e.consts';
import { closeSettings, goToFile, LANGUAGE_IDS, LANGUAGES_PAGE, notification, openLanguagesPage, RUN_FILE_KEY } from '../src/languages.e2e-utils';

/**
 * IDEA-313: Settings › Languages & Frameworks lists every supported language with what works here, the bundled extensions with their
 * licences and the toolchains; a missing toolchain gets a friendly "install X" prompt instead of a failure.
 */
const PYTHON_MISSING = /Python 3 is not installed\./;

test.describe('IDEA-313 Languages page', () => {
    test.setTimeout(180_000);

    test.afterEach(() => {
        fs.rmSync(TOOLCHAIN_OVERRIDES_FILE, { force: true });
    });

    test('lists every language with its support, extensions, licences and toolchains', async ({ page }) => {
        await openIngot(page, LANGUAGE_FIXTURES);
        await setAppearance(page, 'light');
        await dismissNotifications(page);
        const root = await openLanguagesPage(page);
        for (const id of LANGUAGE_IDS) {
            await expect(root.locator(`.ingot-lang-row[data-language="${id}"]`)).toBeVisible();
        }
        await expect(root.locator('#ingot-languages-summary')).toContainText(/\d+ ready/);
        // Node.js runs Ingot itself, so JavaScript / TypeScript is fully ready everywhere.
        await expect(root.locator('.ingot-lang-row[data-language="javascript"]')).toHaveAttribute('data-level', 'ready');
        await expect(root.locator('.ingot-toolchain[data-toolchain="node"]')).toHaveAttribute('data-found', 'true');
        // Highlighting is bundled for every language.
        await expect(root.locator('td[data-feature="grammar"]:not([data-state="ready"])')).toHaveCount(0);

        // A row opens its details: extensions with licences.
        await root.locator('.ingot-lang-row[data-language="java"]').click();
        const details = root.locator('.ingot-lang-details[data-language="java"]');
        await expect(details.locator('.ingot-lang-extension[data-extension="redhat.java"]')).toContainText('EPL-2.0');
        await expect(details.locator('.ingot-lang-extension[data-extension="redhat.java"]')).toHaveAttribute('data-installed', 'true');
        await root.locator('.ingot-lang-row[data-language="python"]').click();
        await expect(root.locator('.ingot-lang-details[data-language="python"] .ingot-lang-extension[data-extension="detachhead.basedpyright"]')).toContainText('MIT');
        await shot(page, 'idea-313-languages-light.png');
        await closeSettings(page);

        await setAppearance(page, 'dark');
        const dark = await openLanguagesPage(page);
        await dark.locator('.ingot-lang-row[data-language="rust"]').click();
        await expect(dark.locator('.ingot-lang-details[data-language="rust"]')).toContainText('MIT OR Apache-2.0');
        await shot(page, 'idea-313-languages-dark.png');
        await closeSettings(page);
        await setAppearance(page, 'light');
    });

    test('opens from Find Action and from the Settings tree', async ({ page }) => {
        await openIngot(page, LANGUAGE_FIXTURES);
        await dismissNotifications(page);
        await runCommand(page, 'Languages and Toolchains');
        await expect(page.locator(LANGUAGES_PAGE)).toBeVisible();
        await closeSettings(page);

        await page.keyboard.press('Control+Alt+S');
        await page.locator('#ingot-settings-node-languages').click();
        await expect(page.locator(LANGUAGES_PAGE)).toBeVisible();
        await expect(page.locator('#ingot-setting-ingot-languages-toolchainPrompts')).toBeChecked();
        await closeSettings(page);
    });

    test('a missing toolchain gets an install prompt instead of a failure, and Re-check picks up the install', async ({ page }) => {
        fs.writeFileSync(TOOLCHAIN_OVERRIDES_FILE, JSON.stringify({ python: 'missing' }));
        await openIngot(page, LANGUAGE_FIXTURES);
        await dismissNotifications(page);

        // Opening a Python file offers the install once.
        await goToFile(page, 'hello.py');
        const prompt = notification(page, PYTHON_MISSING);
        await expect(prompt).toBeVisible({ timeout: 30_000 });
        await expect(prompt).toContainText('Install it with:');
        await expect(prompt.getByRole('button', { name: 'Copy Install Command' })).toBeVisible();
        await expect(prompt.getByRole('button', { name: "Don't Ask Again" })).toBeVisible();
        await shot(page, 'idea-313-install-prompt-light.png');
        await dismissNotifications(page);

        // Run Current File does not fail: it shows the same prompt.
        await page.locator('#theia-main-content-panel .monaco-editor .view-lines').first().click();
        await page.keyboard.press(RUN_FILE_KEY);
        await expect(prompt).toBeVisible({ timeout: 30_000 });
        await prompt.getByRole('button', { name: 'Languages…' }).click();

        const root = page.locator(LANGUAGES_PAGE);
        await expect(root).toBeVisible();
        await expect(root.locator('.ingot-lang-row[data-language="python"]')).toHaveAttribute('data-level', 'needs-toolchain');
        const python = root.locator('.ingot-toolchain[data-toolchain="python"]');
        await expect(python).toHaveAttribute('data-found', 'false');
        await expect(python.locator('.ingot-toolchain-command')).toContainText(/python/i);

        // "Installing" it (the override goes away) and Re-check updates the page.
        fs.rmSync(TOOLCHAIN_OVERRIDES_FILE, { force: true });
        await root.locator('#ingot-languages-refresh').click();
        await expect(python).toHaveAttribute('data-found', 'true', { timeout: 30_000 });
        await expect(root.locator('.ingot-lang-row[data-language="python"] td[data-feature="run"]')).toHaveAttribute('data-state', 'ready');
        await closeSettings(page);
    });
});
