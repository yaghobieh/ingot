import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, type Page } from '@playwright/test';
import { actUntilVisible } from './app.utils';

/** IDEA-130..133 e2e helpers: mock-model tool blocks, a throwaway project, appearance and screenshots. */
export const toolBlock = (name: string, args: Record<string, unknown>): string => `On it.\n\n<<<TOOL ingot/${name}\n${JSON.stringify(args)}\n>>>END\n`;

export const SHOTS_DIR = process.env.INGOT_SHOTS;

export const shot = async (page: Page, name: string): Promise<void> => {
    if (SHOTS_DIR) {
        fs.mkdirSync(SHOTS_DIR, { recursive: true });
        await page.waitForTimeout(300);
        await page.screenshot({ path: path.join(SHOTS_DIR, name) });
    }
};

/** A temp project with a package.json; `serve` announces port 4567 and keeps running. */
export const makeToolsProject = (prefix: string): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), prefix)));
    fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
        name: 'tools-project', private: true,
        scripts: { hello: 'node -e "console.log(\'hello from script\')"', serve: 'node server.js' }
    }, undefined, 2));
    fs.writeFileSync(path.join(dir, 'server.js'), "console.log('Local: http://localhost:4567/');\nsetInterval(() => console.log('tick'), 500);\n");
    return dir;
};

/** Settings › Appearance (Playwright's Desktop Chrome reports Windows, so Settings is Ctrl+Alt+S). */
export const setAppearance = async (page: Page, mode: 'light' | 'dark'): Promise<void> => {
    const dialog = page.locator('#ingot-settings');
    await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), dialog);
    // Settings reopens on the last page; go to Appearance first.
    await page.locator('#ingot-settings-node-appearance').click();
    await page.locator('#ingot-setting-ingot-appearance').selectOption(mode);
    await page.locator('#ingot-settings-ok').click();
    await expect(dialog).toBeHidden();
};
