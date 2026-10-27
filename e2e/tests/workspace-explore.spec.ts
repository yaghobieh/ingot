import * as fs from 'fs';
import * as path from 'path';
import { execFileSync } from 'child_process';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { makeToolsProject } from '../src/agent-tools.e2e-utils';

/**
 * IDEA-186: questions about the open project are answered from local tools (list_dir, read_file, grep),
 * never a guessed GitHub repo; printed shell commands get a nudge to run tools instead; an Explored row sums it up.
 */
const SHOTS = process.env.INGOT_SCREENSHOT_DIR;

const setScheme = async (page: Page, scheme: 'light' | 'dark'): Promise<void> => {
    await page.emulateMedia({ colorScheme: scheme });
    await page.locator('#ingot-rs-theme').click();
    await page.locator('.quick-input-widget .monaco-list-row', { hasText: 'System' }).first().click();
    await expect(page.locator('body')).toHaveClass(new RegExp(`ingot-${scheme}`));
};

for (const scheme of ['light', 'dark'] as const) {
    test.describe(`IDEA-186 local-first project questions (${scheme})`, () => {
        test.setTimeout(150_000);
        let dir: string;
        let server: FakeOllama;
        const systems: string[] = [];
        const users: string[] = [];

        test.beforeEach(async () => {
            dir = makeToolsProject('ingot-explore-');
            fs.mkdirSync(path.join(dir, 'src'));
            fs.writeFileSync(path.join(dir, 'src', 'cart.ts'), 'export const total = (xs: number[]) => xs.reduce((a, b) => a + b, 0);\n');
            execFileSync('git', ['init', '-q'], { cwd: dir });
            execFileSync('git', ['remote', 'add', 'origin', 'https://github.com/acme/widgets.git'], { cwd: dir });
            systems.length = 0;
            users.length = 0;
            server = await startFakeOllama((system, user) => {
                systems.push(system);
                users.push(user);
                if (user.startsWith('You printed shell commands')) {
                    return 'Looking at the project.\n\n<<<TOOL ingot/list_dir\n{"path": "."}\n>>>END';
                }
                if (user.startsWith('Tool result (ingot/list_dir)')) {
                    return '<<<TOOL ingot/read_file\n{"path": "package.json"}\n>>>END';
                }
                if (user.startsWith('Tool result (ingot/read_file)')) {
                    return '<<<TOOL ingot/grep\n{"pattern": "total"}\n>>>END';
                }
                if (user.startsWith('Tool result (ingot/')) {
                    return 'This is **tools-project**: a `hello` and a `serve` script, and `src/cart.ts` sums a cart.';
                }
                return 'Let me check the manifest.\n\n```bash\ncat package.json\n```';
            }, { delayMs: 0 });
        });
        test.afterEach(async () => {
            await server.close();
            fs.rmSync(dir, { recursive: true, force: true });
        });

        test('reads the project locally, runs instead of printing bash, shows Explored', async ({ page }) => {
            await openIngot(page, dir);
            await dismissNotifications(page);
            await setScheme(page, scheme);
            await connectOllama(page, server);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            await page.locator('#ingot-composer-input').fill('learn about the current code');
            await page.locator('#ingot-composer-input').press('Enter');

            const answer = page.locator('#ingot-agents .ingot-chat-agent .ingot-md').last();
            await expect(answer).toContainText('tools-project', { timeout: 40_000 });
            // Local reads need no approval and stay out of the chat as cards; the hidden nudge is never shown.
            await expect(page.locator('#ingot-approval-line')).toHaveCount(0);
            await expect(page.locator('#ingot-agents')).not.toContainText('You printed shell commands');
            await expect(page.locator('#ingot-agents')).not.toContainText('cat package.json');
            await expect(page.locator('#ingot-agents')).not.toContainText('Calling tools');
            await expect(page.locator('#ingot-agents .ingot-chat-step')).toHaveCount(0);
            const explored = page.locator('#ingot-chat-explored');
            await expect(explored).toContainText(/Explored 1 file, 1 folder, 1 search/);
            await explored.locator('.ingot-chat-explored-head').click();
            await expect(explored.locator('.ingot-chat-explored-list li')).toHaveText(['./', 'package.json', '"total"']);

            // The model got the local-first protocol with the repo from the git remote, never a made-up one.
            const system = systems[systems.length - 1];
            expect(system).toContain('ingot/list_dir');
            expect(system).toContain('source of truth');
            expect(system).toContain(dir);
            expect(system).toContain('acme/widgets');
            expect(system).not.toContain('ingot-labs');
            // The tool results really came from disk.
            expect(users.some(u => u.startsWith('Tool result (ingot/read_file)') && u.includes('"tools-project"'))).toBe(true);
            expect(users.some(u => u.startsWith('Tool result (ingot/grep)') && u.includes('src/cart.ts'))).toBe(true);
            expect(users.some(u => u.startsWith('Tool result (ingot/list_dir)') && u.includes('src/'))).toBe(true);

            if (SHOTS) {
                fs.mkdirSync(SHOTS, { recursive: true });
                await page.locator('#ingot-agents').screenshot({ path: path.join(SHOTS, `workspace-explore-${scheme}.png`) });
            }
        });
    });
}
