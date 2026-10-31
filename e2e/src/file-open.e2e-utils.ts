import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, type Page } from '@playwright/test';
import { pickModel } from './chat.e2e-utils';
import type { FakeOllama } from './fake-ollama';
import { connectOllama } from './models.e2e-utils';

/** A reply with a path in code and a relative link, both of which open files when clicked. */
export const FILE_LINK_REPLY = 'The total lives in `src/cart.ts`; see [the notes](docs/notes.md) too.';
const SETTLE_MS = 800;
const NEW_FILE = 'todo.md';

export const makeOpenProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-open-')));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.mkdirSync(path.join(dir, 'docs'));
    fs.writeFileSync(path.join(dir, 'src', 'cart.ts'), 'export const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);\n');
    fs.writeFileSync(path.join(dir, 'docs', 'notes.md'), '# Notes\n');
    fs.writeFileSync(path.join(dir, 'README.md'), '# Shop\n');
    return dir;
};

const agentPanel = (page: Page) => page.locator('#ingot-agents');
const chips = (page: Page) => page.locator('#ingot-agents .ingot-chip, #ingot-agents .ingot-context-chip');
const focusInAgents = (page: Page): Promise<boolean> => page.evaluate(() => !!document.activeElement?.closest('#ingot-agents'));
const activeTab = (page: Page) => page.locator('#theia-main-content-panel .lm-TabBar-tab.lm-mod-current');

const expectEditorOnly = async (page: Page, name: string, panelVisible: boolean): Promise<void> => {
    await expect(activeTab(page)).toContainText(name);
    await page.waitForTimeout(SETTLE_MS);
    await expect(chips(page)).toHaveCount(0);
    expect(await focusInAgents(page)).toBe(false);
    await expect(agentPanel(page)).toBeVisible({ visible: panelVisible });
};

/**
 * Opening a file (a path or link in a reply, the project tree, New File) opens it in the editor and nothing else:
 * no chip in the agent composer, the agent panel is not revealed, and focus does not move into it.
 */
export const checkFilesOpenInEditorOnly = async (page: Page, dir: string, server: FakeOllama): Promise<void> => {
    await connectOllama(page, server);
    if (!await agentPanel(page).isVisible()) {
        await page.locator('#ingot-rs-agents').click();
    }
    await page.locator('#ingot-agents-new').click();
    await pickModel(page, 'ollama-local');
    await page.locator('#ingot-composer-input').click();
    await page.keyboard.type('Where is the total?');
    await page.keyboard.press('Enter');
    const reply = page.locator('#ingot-agents .ingot-chat-agent').last();
    await expect(reply.locator('.ingot-md code')).toHaveText('src/cart.ts');

    await reply.locator('.ingot-md code', { hasText: 'src/cart.ts' }).click();
    await expectEditorOnly(page, 'cart.ts', true);
    await reply.locator('a[data-md-link]').click();
    await expectEditorOnly(page, 'notes.md', true);

    // With the agent panel closed it stays closed.
    await page.locator('#ingot-rs-agents').click();
    await expect(agentPanel(page)).toBeHidden();
    const tree = page.locator('#files');
    await tree.getByText('README.md', { exact: true }).click();
    await expectEditorOnly(page, 'README.md', false);
    await tree.getByText('README.md', { exact: true }).dblclick();
    await expectEditorOnly(page, 'README.md', false);

    await page.locator('#ingot-explorer-new-file').click();
    const input = page.locator('.dialogBlock input').first();
    await expect(input).toBeVisible();
    await input.fill(NEW_FILE);
    await page.keyboard.press('Enter');
    await expect.poll(() => ['', 'docs', 'src'].some(folder => fs.existsSync(path.join(dir, folder, NEW_FILE)))).toBe(true);
    await expectEditorOnly(page, NEW_FILE, false);

    // Back in the chat, the composer is still empty.
    await page.locator('#ingot-rs-agents').click();
    await expect(agentPanel(page)).toBeVisible();
    await expect(chips(page)).toHaveCount(0);
    await expect(page.locator('#ingot-composer-input')).toHaveText('');
};
