import * as fs from 'fs';
import * as path from 'path';
import { expect, test } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { makeToolsProject, setAppearance, shot } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/** IDEA-250: a model that answers in its native XML tool-call format still runs the local tools (nothing printed). */
const NATIVE = [
    "I'll explore the project structure.",
    '',
    '<function_calls> <invoke name="ingot/list_dir"> <parameter name="path">.</parameter> <parameter name="depth">2</parameter> </invoke> </function_calls>'
].join('\n');

for (const scheme of ['light', 'dark'] as const) {
    test(`IDEA-250 native tool calls run instead of printing (${scheme})`, async ({ page }) => {
        test.setTimeout(120_000);
        const dir = makeToolsProject('ingot-native-');
        fs.mkdirSync(path.join(dir, 'src'));
        fs.writeFileSync(path.join(dir, 'src', 'cart.ts'), 'export const total = 1;\n');
        const users: string[] = [];
        const server = await startFakeOllama((_system, user) => {
            users.push(user);
            if (user.startsWith('Tool result (ingot/list_dir)')) {
                return '<function_calls>\n<invoke name="read_file">\n<parameter name="path">package.json</parameter>\n</invoke>\n</function_calls>';
            }
            if (user.startsWith('Tool result (ingot/read_file)')) {
                return 'This is **tools-project** with `src/cart.ts`.';
            }
            return NATIVE;
        }, { delayMs: 0 });
        try {
            await openIngot(page, dir);
            await setAppearance(page, scheme);
            await dismissNotifications(page);
            await connectOllama(page, server);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            await page.locator('#ingot-composer-input').fill('learn about the current code');
            await page.locator('#ingot-composer-input').press('Enter');
            await expect(page.locator('#ingot-agents .ingot-chat-agent .ingot-md').last()).toContainText('tools-project', { timeout: 40_000 });
            for (const raw of ['function_calls', '<invoke', 'parameter name']) {
                await expect(page.locator('#ingot-agents')).not.toContainText(raw);
            }
            await expect(page.locator('#ingot-chat-explored')).toContainText(/Explored 1 file, 1 folder/);
            expect(users.some(u => u.startsWith('Tool result (ingot/list_dir)') && u.includes('src/'))).toBe(true);
            expect(users.some(u => u.startsWith('Tool result (ingot/read_file)') && u.includes('"tools-project"'))).toBe(true);
            await shot(page, `native-tool-calls-${scheme}.png`);
        } finally {
            await server.close();
            fs.rmSync(dir, { recursive: true, force: true });
        }
    });
}
