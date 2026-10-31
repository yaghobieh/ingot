import * as fs from 'fs';
import * as path from 'path';
import { expect, test, type Locator, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { makeToolsProject, setAppearance } from '../src/agent-tools.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { pickModel } from '../src/chat.e2e-utils';
import { saveArtifact } from '../src/artifacts.e2e-utils';

/** Light and dark shots of the agent panel proof: prompt card, agent line, checklist, edited files. */
const save = async (page: Page, name: string): Promise<void> => {
    await saveArtifact(page.locator('.ingot-agents'), name);
};

const box = async (locator: Locator): Promise<{ x: number; y: number; width: number; height: number }> => {
    const found = await locator.boundingBox();
    expect(found).not.toBeNull();
    return found!;
};

test.describe('agent panel proof', () => {
    test.setTimeout(120_000);
    let home: string;
    let server: FakeOllama;

    test.beforeEach(async () => {
        home = makeToolsProject('ingot-panel-');
        const file = path.join(home, 'client', 'src', 'features', 'books');
        fs.mkdirSync(file, { recursive: true });
        fs.writeFileSync(path.join(file, 'Books.tsx'), 'export const Books = () => null;\n');
        server = await startFakeOllama(() => [
            'PLAN:',
            '- Add the books page',
            '- Keep the component small',
            'The page is ready.',
            '<<<EDIT client/src/features/books/Books.tsx',
            'export const Books = () => <section>Books</section>;',
            '>>>END'
        ].join('\n'), { delayMs: 0 });
    });

    test.afterEach(async () => {
        await server.close();
        fs.rmSync(home, { recursive: true, force: true });
    });

    test('shows the prompt card, agent line, checklist, and edited-files footer', async ({ page }) => {
        await openIngot(page, home);
        await dismissNotifications(page);
        await setAppearance(page, 'light');
        await expect(page.locator('body')).toHaveClass(/ingot-light/);
        await connectOllama(page, server);
        const dialog = page.locator('#ingot-settings');
        await actUntilVisible(() => page.keyboard.press('Control+Alt+S'), dialog);
        await page.locator('#ingot-settings-node-agent-review').click();
        const autoAccept = page.locator('#ingot-setting-ingot-agent-review-autoAccept');
        if (await autoAccept.isChecked()) {
            await autoAccept.click();
        }
        const reviewOn = page.locator('#ingot-setting-ingot-agent-review-enabled');
        if (await reviewOn.count() && !await reviewOn.isChecked()) {
            await reviewOn.click();
        }
        await page.locator('#ingot-settings-ok').click();
        await page.locator('#ingot-agents-new').click();
        await pickModel(page, 'ollama-local');
        await page.locator('#ingot-composer-input').fill('Add a books page');
        await page.locator('#ingot-composer-input').press('Enter');

        const prompt = page.locator('.ingot-chat-latest');
        await expect(prompt).toContainText('Add a books page');
        await expect(page.locator('.ingot-chat-agent-head').first()).toContainText('Ingot Agent');
        await expect(page.locator('.ingot-chat-agent-head').first()).toContainText('worked for');
        const checklist = page.locator('#ingot-checklist');
        await expect(checklist).toContainText('Add the books page');
        await expect(checklist).toContainText('Keep the component small');
        await expect(page.locator('.ingot-chat-step')).toHaveCount(0);
        await expect(page.locator('#ingot-turn-activity')).toHaveCount(0);
        await expect(page.locator('#ingot-composer-zaprex')).toHaveCount(0);
        await expect(page.locator('#ingot-changes-summary')).toContainText('Edited 1 file', { timeout: 30_000 });
        const row = page.locator('#ingot-review-files [data-path="client/src/features/books/Books.tsx"]');
        await expect(row.locator('.ingot-file-badge-tsx')).toHaveText('TSX');
        await expect(row.locator('.ingot-review-file-name')).toHaveText('Books.tsx');
        await expect(row.locator('.ingot-review-file-dir')).toHaveText('client/src/features/books');
        await expect(page.locator('#ingot-changes-reject-all')).toHaveText('Reject all');
        await expect(page.locator('#ingot-review-open')).toHaveText('Review');
        await expect(page.locator('#ingot-changes-accept-all')).toHaveText('Accept all');

        const chat = await box(page.locator('.ingot-agents-chat'));
        const promptBox = await box(prompt);
        expect(promptBox.width).toBeGreaterThan(chat.width - 48);
        const card = await box(page.locator('#ingot-edited-card'));
        const bar = await box(page.locator('#ingot-review'));
        const name = await box(row.locator('.ingot-review-file-name'));
        const stats = await box(row.locator('.ingot-review-file-stats'));
        expect(stats.x + stats.width).toBeLessThanOrEqual(card.x + card.width + 1);
        expect(Math.abs(stats.y - name.y)).toBeLessThan(8);
        expect(await row.evaluate(el => getComputedStyle(el).flexWrap)).toBe('nowrap');
        expect((await box(row.locator('.ingot-review-file-state'))).width).toBeLessThan(16);
        const reject = await box(page.locator('#ingot-changes-reject-all'));
        const accept = await box(page.locator('#ingot-changes-accept-all'));
        expect(Math.abs(reject.y - accept.y)).toBeLessThan(4);
        expect(reject.height).toBeLessThan(32);
        expect(accept.x + accept.width).toBeLessThanOrEqual(bar.x + bar.width + 1);
        await expect(page.locator('.ingot-chat-latest .ingot-reactions')).toHaveCount(0);
        expect((await box(checklist.locator('.ingot-check-row').first())).height).toBeLessThan(36);

        await save(page, 'agent-panel-light.png');
        await setAppearance(page, 'dark');
        await expect(page.locator('body')).toHaveClass(/ingot-dark/);
        await save(page, 'agent-panel-dark.png');

        await page.locator('#ingot-review-open').click();
        await expect(page.locator('#shell-tab-ingot-agent-review')).toBeVisible();
        await expect(page.locator('.ingot-rv-file[data-path="client/src/features/books/Books.tsx"]')).toBeVisible();
    });
});
