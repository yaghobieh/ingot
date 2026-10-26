import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';

/** IDEA-131: the agent runs commands and package scripts (foreground / background) through the approval card, with a mock model. */
const tool = (name: string, args: Record<string, unknown>): string => `On it.\n\n<<<TOOL ingot/${name}\n${JSON.stringify(args)}\n>>>END\n`;
const SHOTS = process.env.INGOT_SHOTS;
const shot = async (page: Page, name: string): Promise<void> => {
    if (SHOTS) {
        fs.mkdirSync(SHOTS, { recursive: true });
        await page.screenshot({ path: path.join(SHOTS, name) });
    }
};

test.describe('IDEA-131 agent terminal and run tools', () => {
    test.setTimeout(150_000);
    let dir: string;
    let server: FakeOllama;
    let reply: (user: string) => string;

    test.beforeEach(async () => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-run-tools-')));
        fs.writeFileSync(path.join(dir, 'package.json'), JSON.stringify({
            name: 'run-tools', private: true,
            scripts: { hello: 'node -e "console.log(\'hello from script\')"', serve: 'node server.js' }
        }, undefined, 2));
        fs.writeFileSync(path.join(dir, 'server.js'), "require('http').createServer((q, s) => s.end('ok')).listen(0, () => { console.log('Local: http://localhost:' + 4567); setInterval(() => undefined, 1000); });\n");
        server = await startFakeOllama((_system, user) => reply(user), { delayMs: 0 });
    });
    test.afterEach(async () => {
        await server.close();
        fs.rmSync(dir, { recursive: true, force: true });
    });

    const start = async (page: Page): Promise<void> => {
        await openIngot(page, dir);
        await dismissNotifications(page);
        await connectOllama(page, server);
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
    };
    const ask = async (page: Page, text: string): Promise<void> => {
        await page.locator('#ingot-composer-input').fill(text);
        await page.locator('#ingot-composer-input').press('Enter');
    };

    test('lists scripts, runs one in the foreground after Run, then Always Run skips the card for that command only', async ({ page }) => {
        reply = (user: string): string => {
            if (user.startsWith('Tool result (ingot/scripts)')) {
                return tool('run_script', { script: 'hello' });
            }
            if (user.startsWith('Tool result (ingot/run)')) {
                return user.includes('hello from script') && user.includes('Exit code 0') ? 'The script printed hello.' : 'Something went wrong.';
            }
            if (user.includes('other command')) {
                return tool('run', { command: 'node -e "console.log(41 + 1)"' });
            }
            return tool('scripts', {});
        };
        await start(page);
        await ask(page, 'run the hello script');
        // `scripts` runs at once; `run_script` resolves to the real command on the card.
        await expect(page.locator('#ingot-approval-line')).toHaveText('Run command: npm run hello', { timeout: 30_000 });
        expect(server.requests.some(r => r.user.includes('- hello: node -e') && r.user.includes('Package manager: npm'))).toBe(true);
        await shot(page, 'idea-131-card-light.png');
        await page.locator('#ingot-approval-always').click();
        await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('The script printed hello.', { timeout: 30_000 });

        // Same command again: no card.
        await ask(page, 'run the hello script again');
        await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('The script printed hello.', { timeout: 30_000 });
        await expect(page.locator('#ingot-approval')).toHaveCount(0);

        // A different command still asks.
        await ask(page, 'other command');
        await expect(page.locator('#ingot-approval-line')).toHaveText('Run command: node -e "console.log(41 + 1)"', { timeout: 30_000 });
        await page.locator('#ingot-approval-skip').click();

        // Settings › Agent approvals lists the command; Revoke removes it.
        // Playwright's Desktop Chrome reports Windows, so Settings is Ctrl+Alt+S.
        await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), page.locator('#ingot-settings'));
        await page.locator('#ingot-settings-node-agent-approvals').click();
        const row = page.locator('.ingot-always-run-row[data-kind="command"][data-command="npm run hello"]').filter({ hasText: dir });
        await expect(row).toHaveCount(1);
        await row.locator('.ingot-always-run-revoke').click();
        await expect(row).toHaveCount(0);
        await page.locator('#ingot-settings-ok').click();
    });

    test('a background dev server keeps running, reports its port, and the agent reads its output and stops it', async ({ page }) => {
        reply = (user: string): string => {
            if (user.startsWith('Tool result (ingot/run)')) {
                const id = /as (p\d+)/.exec(user)?.[1] ?? 'p0';
                return user.includes('on port 4567') ? tool('process_output', { id }) : 'No port.';
            }
            if (user.startsWith('Tool result (ingot/process_output)')) {
                const id = /^Tool result \(ingot\/process_output\)[\s\S]*?(p\d+) \[Running\]/.exec(user)?.[1] ?? 'p0';
                return tool('process_stop', { id });
            }
            if (user.startsWith('Tool result (ingot/process_stop)')) {
                return user.includes('Stopped') ? 'Server stopped.' : 'Could not stop.';
            }
            return tool('run_script', { script: 'serve', background: true });
        };
        await start(page);
        await ask(page, 'start the server');
        await expect(page.locator('#ingot-approval-line')).toHaveText('Run in background: npm run serve', { timeout: 30_000 });
        await page.keyboard.press('Enter');
        // Stopping a process the agent started itself does not ask.
        await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('Server stopped.', { timeout: 45_000 });
        expect(server.requests.some(r => r.user.includes('Local: http://localhost:4567'))).toBe(true);
    });
});
