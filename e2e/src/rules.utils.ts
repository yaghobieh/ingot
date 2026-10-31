import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, type Locator, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from './app.utils';

/** Shared setup for the `.ingot/rules` tool specs (export, rule tests, prune, learned rules). */
export const RULES_SHOTS_DIR = process.env.INGOT_SHOTS_DIR;
export const SCHEMES = ['light', 'dark'] as const;
export type Scheme = typeof SCHEMES[number];

export const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });

/** A committed git project with the given files; returns the project folder and the temp base to delete. */
export const makeRulesProject = (files: Record<string, string>, name = 'shop'): { repo: string; base: string } => {
    const base = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-rules-')));
    const repo = path.join(base, name);
    fs.mkdirSync(repo);
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'e2e@ingot.dev');
    git(repo, 'config', 'user.name', 'E2E Bot');
    for (const [file, text] of Object.entries(files)) {
        fs.mkdirSync(path.dirname(path.join(repo, file)), { recursive: true });
        fs.writeFileSync(path.join(repo, file), text);
    }
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '--no-verify', '-m', 'Init');
    return { repo, base };
};

export const readIn = (repo: string, file: string): string => fs.readFileSync(path.join(repo, file), 'utf8');
export const existsIn = (repo: string, file: string): boolean => fs.existsSync(path.join(repo, file));

/** Opens the project with Ingot following the OS color scheme (Theme › System). */
export const openWithScheme = async (page: Page, scheme: Scheme, repo: string): Promise<void> => {
    await page.emulateMedia({ colorScheme: scheme });
    await openIngot(page, repo);
    await page.locator('#ingot-rs-theme').click();
    await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'System' }).first().click();
    await expect(page.locator('body')).toHaveClass(new RegExp(`ingot-${scheme}`));
    await dismissNotifications(page);
};

/** Rules & MCP page › Rules tab (right stripe). */
export const openRulesTab = async (page: Page): Promise<Locator> => {
    await page.locator('#ingot-rs-mcp').click();
    await page.locator('#ingot-mcp-tab-rules').click();
    const rules = page.locator('#ingot-mcp-items-rule');
    await expect(rules).toBeVisible();
    return rules;
};

/** Saves `ingot-<name>.png` when INGOT_SHOTS_DIR is set. */
export const rulesShot = async (page: Page, name: string, target: Locator = page.locator('body')): Promise<void> => {
    if (RULES_SHOTS_DIR) {
        fs.mkdirSync(RULES_SHOTS_DIR, { recursive: true });
        await page.mouse.move(0, 0);
        await target.screenshot({ path: path.join(RULES_SHOTS_DIR, `ingot-${name}.png`) });
    }
};
