import * as fs from 'fs';
import * as path from 'path';
import { expect, test } from '@playwright/test';
import { runCommand } from '../src/app.utils';
import { toolBlock } from '../src/agent-tools.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { answer, makeProject, openView, openWithScheme, removeProject, saveShot, SCHEMES } from '../src/ingot-dot.e2e-utils';
import { connectOllama } from '../src/models.e2e-utils';

/** IDEA-324: Kiro-style specs in .ingot/specs/<feature>/ (Create Spec, the Specs view, and agent runs that tick tasks off). */
const TASKS = `# Implementation plan: Checkout flow

- [x] 1. Add the cart model
  - _Requirements: 1_
- [ ] 2. Payment
  - [ ] 2.1 Validate the card form
    - _Requirements: 2.1_
  - [ ] 2.2 Call the payment API
- [ ] 3. Show the receipt
`;

test.describe('IDEA-324 specs', () => {
    test.setTimeout(150_000);
    let dir = '';
    test.afterEach(() => removeProject(dir));

    for (const scheme of SCHEMES) {
        test(`Create Spec writes requirements, design and tasks; the Specs view ticks tasks off (${scheme})`, async ({ page }) => {
            dir = makeProject('ingot-specs-', { 'package.json': '{"name":"shop","private":true}\n' });
            await openWithScheme(page, scheme, dir);
            const view = page.locator('#ingot-specs');
            await openView(page, 'View: Toggle Specs', view);
            await expect(view.locator('#ingot-specs-empty')).toBeVisible();

            await view.locator('#ingot-specs-new').click();
            await answer(page, 'user login', 'Feature name');
            await answer(page, 'Sign in with email and password.', 'what should it do');
            const specDir = path.join(dir, '.ingot', 'specs', 'user-login');
            await expect.poll(() => ['requirements.md', 'design.md', 'tasks.md'].every(f => fs.existsSync(path.join(specDir, f)))).toBe(true);
            expect(fs.readFileSync(path.join(specDir, 'requirements.md'), 'utf8')).toContain('# Requirements: User login');
            expect(fs.readFileSync(path.join(specDir, 'requirements.md'), 'utf8')).toContain('Sign in with email and password.');
            await expect(page.locator('.lm-TabBar-tab.lm-mod-current, .p-TabBar-tab.p-mod-current').filter({ hasText: 'requirements.md' }).first()).toBeVisible();

            const spec = view.locator('.ingot-spec[data-spec="user-login"]');
            await expect(spec.locator('.ingot-spec-title')).toHaveText('User login');
            await expect(spec.locator('.ingot-spec-count')).toHaveText('0/5');
            await expect(spec.locator('.ingot-spec-task')).toHaveCount(6);
            const first = spec.locator('.ingot-spec-task[data-task="1"] input[type="checkbox"]');
            await first.click();
            await expect(first).toBeChecked();
            await expect(spec.locator('.ingot-spec-count')).toHaveText('1/5');
            await expect.poll(() => fs.readFileSync(path.join(specDir, 'tasks.md'), 'utf8')).toContain('- [x] 1. Set up the module structure');
            await expect(spec.locator('.ingot-spec-run-next')).toContainText('2.1');
            await saveShot(page, 'specs', scheme);
        });
    }

    test('Run next task sends the task to the agent, which checks it off with spec_task', async ({ page }) => {
        dir = makeProject('ingot-specs-run-', {
            '.ingot/specs/checkout-flow/requirements.md': '# Requirements: Checkout flow\n\n1. WHEN a user pays THE SYSTEM SHALL show a receipt.\n',
            '.ingot/specs/checkout-flow/design.md': '# Design: Checkout flow\n',
            '.ingot/specs/checkout-flow/tasks.md': TASKS
        });
        let server: FakeOllama | undefined;
        try {
            const tasksFile = path.join(dir, '.ingot/specs/checkout-flow/tasks.md');
            server = await startFakeOllama((_system, user) => {
                if (fs.readFileSync(tasksFile, 'utf8').includes('- [x] 2.1')) {
                    return 'Task 2.1 is done.';
                }
                return user.startsWith('Implement task 2.1') ? toolBlock('spec_task', { spec: 'checkout-flow', task: '2.1', done: true }) : 'Hello.';
            }, { delayMs: 0 });
            await openWithScheme(page, 'light', dir);
            await connectOllama(page, server);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');

            const view = page.locator('#ingot-specs');
            await openView(page, 'View: Toggle Specs', view);
            const spec = view.locator('.ingot-spec[data-spec="checkout-flow"]');
            await expect(spec.locator('.ingot-spec-count')).toHaveText('1/4');
            await spec.locator('.ingot-spec-run-next').click();

            await expect(page.locator('#ingot-agents .ingot-chat-agent').last()).toContainText('Task 2.1 is done.', { timeout: 60_000 });
            const sent = server.requests.find(r => r.user.startsWith('Implement task 2.1'));
            expect(sent?.user).toContain('Read .ingot/specs/checkout-flow/requirements.md');
            expect(sent?.system).toContain('ingot/spec_task');
            await expect.poll(() => fs.readFileSync(path.join(dir, '.ingot/specs/checkout-flow/tasks.md'), 'utf8')).toContain('- [x] 2.1 Validate the card form');
            await expect(spec.locator('.ingot-spec-count')).toHaveText('2/4');
            await expect(spec.locator('.ingot-spec-task[data-task="2.1"] input')).toBeChecked();
            await expect(spec.locator('.ingot-spec-run-next')).toContainText('2.2');

            // Run Next Spec Task from Find Action picks the next open task.
            await runCommand(page, 'Agents: Run Next Spec Task');
            await expect.poll(() => server?.requests.some(r => r.user.startsWith('Implement task 2.2'))).toBe(true);
        } finally {
            await server?.close();
        }
    });
});
