import * as fs from 'fs';
import { expect, test, type Page } from '@playwright/test';
import { runCommand } from '../src/app.utils';
import { pickModel } from '../src/chat.e2e-utils';
import { startFakeOllama, type FakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';
import { SCHEMES, daysAgo, existsIn, makeRulesProject, openRulesTab, openWithScheme, readIn, rulesShot, writeIn } from '../src/rules.utils';

/** IDEA-323: Rules tab › Prune lists stale rules (unused, dead globs, deleted paths, removed packages) and removes the chosen ones. */
const FILES = {
    'package.json': JSON.stringify({ name: 'shop', dependencies: { react: '^19.0.0' } }, undefined, 2),
    'src/app.ts': 'export const app = 1;\n',
    '.ingot/rules/style.md': '---\nalwaysApply: true\n---\nUse named exports.\n',
    '.ingot/rules/vue.md': '---\nglobs: src/**/*.vue\n---\nUse script setup.\n',
    '.ingot/rules/mixed.md': '---\nglobs:\n  - src/**/*.vue\n  - src/**/*.ts\n---\nKeep components small.\n',
    '.ingot/rules/legacy.md': '---\nalwaysApply: true\n---\nNever import from `src/api/legacy.ts`.\n',
    '.ingot/rules/moment.md': '---\nalwaysApply: true\ndeps: [moment]\n---\nFormat dates with moment.\n',
    '.ingot/rules/old.md': '---\nalwaysApply: true\n---\nWrite commit messages in the past tense.\n'
};
const HITS = {
    version: 1,
    since: daysAgo(200),
    rules: {
        '.ingot/rules/style.md': { hits: 40, lastHit: daysAgo(1) },
        '.ingot/rules/vue.md': { hits: 2, lastHit: daysAgo(3) },
        '.ingot/rules/mixed.md': { hits: 2, lastHit: daysAgo(3) },
        '.ingot/rules/legacy.md': { hits: 3, lastHit: daysAgo(2) },
        '.ingot/rules/moment.md': { hits: 3, lastHit: daysAgo(2) },
        '.ingot/rules/old.md': { hits: 1, lastHit: daysAgo(150) }
    }
};

const dialog = (page: Page) => page.locator('#ingot-rules-prune-dialog');
const candidate = (page: Page, rule: string) => dialog(page).locator(`#ingot-rules-prune-candidates li[data-path=".ingot/rules/${rule}.md"]`);

test.describe('IDEA-323 ingot rules prune', () => {
    let base = '';
    test.afterEach(() => {
        if (base) {
            fs.rmSync(base, { recursive: true, force: true });
        }
    });

    for (const scheme of SCHEMES) {
        test(`Rules tab › Prune finds stale rules and applies only the checked ones (${scheme})`, async ({ page }) => {
            const made = makeRulesProject(FILES, daysAgo(200));
            base = made.base;
            writeIn(made.repo, '.ingot/.state/rule-hits.json', JSON.stringify(HITS));
            await openWithScheme(page, scheme, made.repo);
            await openRulesTab(page);
            await page.locator('#ingot-mcp-rules-prune').click();

            await expect(dialog(page)).toBeVisible();
            await expect(dialog(page).locator('#ingot-rules-prune-status')).toContainText('5 of 6 rules look stale');
            await expect(candidate(page, 'vue')).toHaveAttribute('data-action', 'delete');
            await expect(candidate(page, 'vue').locator('[data-reason="dead-globs"]')).toBeVisible();
            await expect(candidate(page, 'mixed')).toHaveAttribute('data-action', 'remove-globs');
            await expect(candidate(page, 'mixed')).toContainText('keeps src/**/*.ts');
            await expect(candidate(page, 'legacy')).toHaveAttribute('data-action', 'review');
            await expect(candidate(page, 'legacy').locator('[data-reason="dead-paths"]')).toContainText('no longer exists');
            await expect(candidate(page, 'legacy').locator('input')).toBeDisabled();
            await expect(candidate(page, 'moment').locator('[data-reason="missing-deps"]')).toBeVisible();
            await expect(candidate(page, 'old').locator('[data-reason="unused"]')).toContainText('last used 150 days ago');
            await expect(candidate(page, 'style')).toHaveCount(0);
            await expect(dialog(page).locator('#ingot-rules-prune-apply')).toHaveText('Apply to 4 rules');
            await rulesShot(page, `rules-prune-${scheme}`);

            await candidate(page, 'old').locator('input').uncheck();
            await expect(dialog(page).locator('#ingot-rules-prune-apply')).toHaveText('Apply to 3 rules');
            await dialog(page).locator('#ingot-rules-prune-apply').click();
            await expect(dialog(page).locator('#ingot-rules-prune-status')).toContainText('2 of 4 rules look stale');

            expect(existsIn(made.repo, '.ingot/rules/vue.md')).toBe(false);
            expect(existsIn(made.repo, '.ingot/rules/moment.md')).toBe(false);
            expect(readIn(made.repo, '.ingot/rules/mixed.md')).toBe('---\nglobs:\n  - src/**/*.ts\n---\nKeep components small.\n');
            expect(existsIn(made.repo, '.ingot/rules/old.md')).toBe(true);
            expect(existsIn(made.repo, '.ingot/rules/legacy.md')).toBe(true);
        });
    }

    test.describe('rule hits', () => {
        let server: FakeOllama | undefined;
        test.afterEach(async () => {
            await server?.close();
            server = undefined;
        });

        test('agent turns record which project rules they used; Prune waits for enough usage data', async ({ page }) => {
            server = await startFakeOllama(() => 'Done.');
            const made = makeRulesProject({ 'src/app.ts': 'export const app = 1;\n', '.ingot/rules/style.md': FILES['.ingot/rules/style.md'], '.ingot/rules/react.md': '---\nglobs: src/**/*.tsx\n---\nUse function components.\n' });
            base = made.base;
            await openWithScheme(page, 'light', made.repo);
            await connectOllama(page, server);
            await page.locator('#ingot-agents-new').click();
            await pickModel(page, 'ollama-local');
            await page.locator('#ingot-composer-input').fill('Add a sum helper');
            await page.locator('#ingot-composer-input').press('Enter');
            await expect(page.locator('#ingot-agents .ingot-chat-agent .ingot-md').last()).toContainText('Done.');

            await expect.poll(() => existsIn(made.repo, '.ingot/.state/rule-hits.json'), { timeout: 15_000 }).toBe(true);
            const log = JSON.parse(readIn(made.repo, '.ingot/.state/rule-hits.json'));
            expect(log.rules['.ingot/rules/style.md'].hits).toBe(1);
            expect(log.rules['.ingot/rules/react.md']).toBeUndefined();
            expect(readIn(made.repo, '.ingot/.state/.gitignore')).toBe('*\n');

            await runCommand(page, 'Prune Stale Rules');
            await expect(dialog(page).locator('#ingot-rules-prune-window')).toContainText(`Usage tracked since ${log.since.slice(0, 10)}`);
            await expect(dialog(page).locator('#ingot-rules-prune-status')).toContainText('1 of 2 rules look stale');
            await expect(candidate(page, 'react').locator('[data-reason="dead-globs"]')).toBeVisible();
            await expect(candidate(page, 'style')).toHaveCount(0);
        });
    });
});
