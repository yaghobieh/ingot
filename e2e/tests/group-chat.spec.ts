import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { dismissNotifications, openIngot } from '../src/app.utils';
import { FIXTURES_DIR, GROUP_FIXTURE } from '../src/e2e.consts';

const README = path.join(FIXTURES_DIR, 'second-project', 'README.md');
const EDIT_TEXT = 'Endpoint renamed by the sample-project agent';
const chat = (page: Page) => page.locator('#ingot-group-chat');
const agents = (page: Page) => page.locator('#ingot-agents');

const send = async (page: Page, text: string): Promise<void> => {
    await page.locator('#ingot-composer-input').fill(text);
    await page.locator('#ingot-composer-input').press('Enter');
};

test.describe('IDEA-53 group agent channel', () => {
    test.afterEach(() => execFileSync('git', ['checkout', '--', README], { cwd: FIXTURES_DIR }));

    test('agents ask and answer across projects; cross-project edits wait for approval', async ({ page }) => {
        await openIngot(page, GROUP_FIXTURE);
        await expect(page.locator('#ingot-project-tab-sample-project')).toHaveClass(/active/, { timeout: 30_000 });

        // sample-project agent asks second-project.
        await page.locator('#ingot-agents-new').click();
        await send(page, '/ask second-project Which endpoint returns the user?');
        await expect(agents(page).locator('.ingot-chat-system').last()).toContainText('Asked second-project');
        await expect(chat(page)).toBeVisible();
        await expect(chat(page).locator('.ingot-gc-ask')).toContainText('Which endpoint returns the user?');
        await expect(chat(page).locator('.ingot-gc-ask .ingot-gc-who')).toHaveText(/sample-project · .* asks second-project/);

        // second-project agent receives it and replies.
        await page.locator('#ingot-project-tab-second-project').click();
        await expect(agents(page)).toBeVisible();
        await expect(agents(page).locator('.ingot-chat-tab', { hasText: 'Group inbox' })).toBeVisible();
        await agents(page).locator('.ingot-chat-tab', { hasText: 'Group inbox' }).click();
        await expect(agents(page).locator('.ingot-chat-peer')).toContainText('Which endpoint returns the user?');
        await send(page, '/reply GET /users/:id');
        await expect(chat(page).locator('.ingot-gc-reply')).toContainText('GET /users/:id');

        // Back in sample-project the answer arrived; request a cross-project edit.
        await page.locator('#ingot-project-tab-sample-project').click();
        await expect(agents(page).locator('.ingot-chat-peer').last()).toContainText('GET /users/:id');
        await send(page, `/edit second-project README.md ${EDIT_TEXT}`);
        await dismissNotifications(page);
        const edit = chat(page).locator('.ingot-gc-edit').last();
        await expect(edit).toContainText('Needs your approval');
        expect(fs.readFileSync(README, 'utf8')).not.toContain(EDIT_TEXT);

        // Deny one, approve another: only the approved one is written.
        await edit.locator('.ingot-gc-deny').click();
        await expect(edit).toContainText('denied');
        expect(fs.readFileSync(README, 'utf8')).not.toContain(EDIT_TEXT);
        await send(page, `/edit second-project README.md ${EDIT_TEXT}`);
        await chat(page).locator('.ingot-gc-edit').last().locator('.ingot-gc-approve').click();
        await expect(chat(page).locator('.ingot-gc-edit').last()).toContainText('approved');
        await expect.poll(() => fs.readFileSync(README, 'utf8')).toContain(EDIT_TEXT);
    });

    test('refuses edits outside the target project', async ({ page }) => {
        await openIngot(page, GROUP_FIXTURE);
        await expect(page.locator('#ingot-project-tab-sample-project')).toHaveClass(/active/, { timeout: 30_000 });
        await page.locator('#ingot-agents-new').click();
        await send(page, '/edit second-project ../escape.txt nope');
        await expect(agents(page).locator('.ingot-chat-system').last()).toContainText('Edits must stay inside second-project');
    });
});
