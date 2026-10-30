import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications } from '../src/app.utils';
import { launchDesktop, type DesktopApp } from '../src/electron.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { shot, toolBlock } from '../src/agent-tools.e2e-utils';

/**
 * IDEA-259: the agent follows, renames and checks code through the TypeScript language server, shown as steps in the chat.
 * Desktop only: in the browser build the TypeScript extension sees a web UI and runs syntax-only (no cross-file results).
 */
const MATH = 'export const add = (a: number, b: number): number => a + b;\n';
const MAIN = [
    "import { zero } from './unused';",
    "import { add } from './math';",
    '',
    'export const total: number = add(1, 2);',
    "export const label: number = 'oops';",
    ''
].join('\n');
const DONE = 'Renamed add to sum and checked main.ts.';
/** The TypeScript server starts with the first .ts file and loads the project, so the first call can take a while. */
const LANGUAGE_TIMEOUT_MS = 120_000;

const makeTsProject = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-code-tools-')));
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'tsconfig.json'), JSON.stringify({ compilerOptions: { strict: true, target: 'es2020', module: 'commonjs', noEmit: true }, include: ['src'] }, undefined, 2));
    fs.writeFileSync(path.join(dir, 'src', 'math.ts'), MATH);
    fs.writeFileSync(path.join(dir, 'src', 'unused.ts'), 'export const zero = 0;\n');
    fs.writeFileSync(path.join(dir, 'src', 'main.ts'), MAIN);
    return dir;
};

const card = (page: Page, tool: string) => page.locator(`#ingot-agents .ingot-tc-generic[data-tool="ingot/${tool}"]`).last();

const setScheme = async (page: Page, scheme: 'light' | 'dark'): Promise<void> => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.locator('#ingot-rs-theme').click();
    await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'System' }).first().click();
    await expect(page.locator('body')).toHaveClass(new RegExp(`ingot-${scheme}`));
};

test.describe('IDEA-259 agent code tools (desktop)', () => {
    test.setTimeout(300_000);
    let dir: string;
    let server: FakeOllama;
    let desktop: DesktopApp | undefined;

    test.beforeEach(async () => {
        dir = makeTsProject();
        server = await startFakeOllama((_system, user) => {
            if (user.startsWith('Tool result (ingot/go_to_definition)')) {
                return toolBlock('find_references', { path: 'src/math.ts', symbol: 'add' });
            }
            if (user.startsWith('Tool result (ingot/find_references)')) {
                return toolBlock('rename_symbol', { path: 'src/math.ts', symbol: 'add', new_name: 'sum' });
            }
            if (user.startsWith('Tool result (ingot/rename_symbol)')) {
                return toolBlock('organize_imports', { path: 'src/main.ts' });
            }
            if (user.startsWith('Tool result (ingot/organize_imports)')) {
                return toolBlock('diagnostics', { path: 'src/main.ts' });
            }
            if (user.startsWith('Tool result (ingot/diagnostics)')) {
                return DONE;
            }
            return toolBlock('go_to_definition', { path: 'src/main.ts', symbol: 'add', line: 4 });
        }, { delayMs: 0 });
    });
    test.afterEach(async () => {
        await desktop?.close();
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    test('goes to a definition, finds references, renames, organizes imports and lists problems', async () => {
        desktop = await launchDesktop(dir);
        const { page } = desktop;
        await dismissNotifications(page);
        await setScheme(page, 'light');
        await connectOllama(page, server);
        if (!await page.locator('#ingot-composer-input').isVisible()) {
            await page.locator('#ingot-rs-agents').click();
        }
        await pickModel(page, 'ollama-local');
        await page.locator('#ingot-composer-input').click();
        await page.keyboard.type('rename add to sum, tidy the imports of main.ts and check it');
        await page.keyboard.press('Enter');
        await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText(DONE, { timeout: LANGUAGE_TIMEOUT_MS });

        // What the model got back from the language server.
        const result = (tool: string): string => server.requests.map(r => r.user).find(u => u.startsWith(`Tool result (ingot/${tool})`)) ?? '';
        expect(result('go_to_definition')).toContain('src/math.ts:1:14  export const add');
        expect(result('find_references')).toContain('3 references in 2 files:');
        expect(result('find_references')).toContain('src/main.ts:4:30  export const total: number = add(1, 2);');
        expect(result('rename_symbol')).toContain('Renamed add to sum in 2 file(s): ');
        expect(result('organize_imports')).toContain('Organized imports in 1 file(s): src/main.ts.');
        // Read after organize imports: the unused import is gone, so the bad line is now line 4.
        expect(result('diagnostics')).toMatch(/src\/main\.ts:4:14 error Type 'string' is not assignable to type 'number'\. \(ts 2322\)/);

        // Each call is a checklist step and a card with its own title, icon and target.
        await expect(page.locator('#ingot-agents .ingot-step-text', { hasText: 'Find references: add · src/math.ts' })).toHaveCount(1);
        await expect(page.locator('#ingot-agents .ingot-step-text', { hasText: 'Rename: add → sum · src/math.ts' })).toHaveCount(1);
        await expect(card(page, 'go_to_definition').locator('.ingot-tc-title')).toHaveText('Went to definition');
        await expect(card(page, 'find_references').locator('.ingot-tc-programs')).toHaveText('add · src/math.ts');
        await expect(card(page, 'find_references').locator('.codicon-references')).toHaveCount(1);
        await expect(card(page, 'rename_symbol').locator('.ingot-tc-programs')).toHaveText('add → sum · src/math.ts');
        await expect(card(page, 'organize_imports').locator('.ingot-tc-title')).toHaveText('Organized imports');
        await expect(card(page, 'diagnostics').locator('.ingot-tc-status.ok')).toHaveCount(1);
        await card(page, 'find_references').locator('.ingot-tc-head').click();
        await expect(card(page, 'find_references').locator('.ingot-tc-output')).toContainText('src/main.ts:2:10');
        await shot(page, 'idea-259-code-tools-light.png');
        await setScheme(page, 'dark');
        await shot(page, 'idea-259-code-tools-dark.png');

        // The edits went through the review like any agent edit; Accept all writes them.
        await page.locator('#ingot-changes-accept-all').click();
        await expect.poll(() => fs.readFileSync(path.join(dir, 'src', 'math.ts'), 'utf8'), { timeout: 30_000 }).toContain('export const sum');
        await expect.poll(() => fs.readFileSync(path.join(dir, 'src', 'main.ts'), 'utf8'), { timeout: 30_000 })
            .toBe(MAIN.replace("import { zero } from './unused';\n", '').replace(/\badd\b/g, 'sum'));
    });
});
