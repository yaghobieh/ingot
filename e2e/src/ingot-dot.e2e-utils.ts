import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, type Locator, type Page } from '@playwright/test';
import { dismissNotifications, openIngot, quickInput, runCommand } from './app.utils';
import { E2E_CONFIG_DIR } from './e2e.consts';

/** IDEA-316 e2e helpers (specs, policy.yaml, rule packs): throwaway projects, theme and screenshots in ./shots. */
export type Scheme = 'light' | 'dark';
export const SCHEMES: readonly Scheme[] = ['light', 'dark'];

/** `ingot-<feature>-<light|dark>.png` in the repo's shots/ folder (INGOT_DOT_SHOTS overrides). */
export const SHOTS_DIR = process.env.INGOT_DOT_SHOTS ?? path.resolve(__dirname, '..', '..', 'shots');
export const AUDIT_LOG = path.join(E2E_CONFIG_DIR, 'audit', 'agent-audit.jsonl');

export const makeProject = (prefix: string, files: Record<string, string>): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    for (const [file, content] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
        fs.writeFileSync(path.join(dir, file), content);
    }
    return dir;
};

/** Removes a project, including read-only files written for enforced packs. */
export const removeProject = (dir: string): void => {
    const unlock = (target: string): void => {
        for (const entry of fs.readdirSync(target, { withFileTypes: true })) {
            const full = path.join(target, entry.name);
            fs.chmodSync(full, entry.isDirectory() ? 0o755 : 0o644);
            if (entry.isDirectory()) {
                unlock(full);
            }
        }
    };
    if (fs.existsSync(dir)) {
        unlock(dir);
        fs.rmSync(dir, { recursive: true, force: true });
    }
};

/** Opens the project with the OS color scheme and Ingot's theme set to System, like the theme picker spec. */
export const openWithScheme = async (page: Page, scheme: Scheme, dir: string): Promise<void> => {
    await page.emulateMedia({ colorScheme: scheme });
    await openIngot(page, dir);
    await page.locator('#ingot-rs-theme').click();
    await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'System' }).first().click();
    await expect(page.locator('body')).toHaveClass(new RegExp(`ingot-${scheme}`));
    await dismissNotifications(page);
};

export const saveShot = async (page: Page, feature: string, scheme: Scheme, target?: Locator): Promise<void> => {
    fs.mkdirSync(SHOTS_DIR, { recursive: true });
    await page.mouse.move(0, 0);
    await page.waitForTimeout(300);
    await (target ?? page).screenshot({ path: path.join(SHOTS_DIR, `ingot-${feature}-${scheme}.png`) });
};

/** Opens a view through Find Action (F1), like a user. */
export const openView = async (page: Page, label: string, view: Locator): Promise<void> => {
    await expect(async () => {
        if (!await view.isVisible()) {
            await runCommand(page, label);
        }
        await expect(view).toBeVisible({ timeout: 3_000 });
    }).toPass({ timeout: 30_000 });
};

/** Answers the next quick input box (Create Spec…, Add Rule Pack…). */
export const answer = async (page: Page, text: string, prompt: string): Promise<void> => {
    const box = page.locator('.quick-input-widget .quick-input-box input');
    await expect(page.locator('.quick-input-widget')).toContainText(prompt);
    await expect(box).toBeVisible();
    await box.fill(text);
    await box.press('Enter');
};

/** Opens a project file through Go to File (F1 without ">"). */
export const openFile = async (page: Page, relative: string): Promise<void> => {
    await page.keyboard.press('F1');
    await expect(quickInput(page)).toBeVisible();
    await quickInput(page).fill(relative);
    await page.locator('.quick-input-list .monaco-list-row').filter({ hasText: path.basename(relative) }).first().click();
    await expect(page.locator('.theia-editor').first()).toBeVisible();
};

export const ask = async (page: Page, text: string): Promise<void> => {
    await page.locator('#ingot-composer-input').fill(text);
    await page.locator('#ingot-composer-input').press('Enter');
};

export const auditLines = (): { tool: string; decision: string; outcome: string; reason?: string }[] =>
    fs.existsSync(AUDIT_LOG) ? fs.readFileSync(AUDIT_LOG, 'utf8').split('\n').filter(Boolean).map(line => JSON.parse(line)) : [];
