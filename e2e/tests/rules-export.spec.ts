import * as fs from 'fs';
import { expect, test, type Page } from '@playwright/test';
import { runCommand } from '../src/app.utils';
import { SCHEMES, existsIn, makeRulesProject, openRulesTab, openWithScheme, readIn, rulesShot } from '../src/rules.utils';

/** IDEA-319: Rules tab › Export writes .ingot/rules to AGENTS.md, CLAUDE.md, Cursor, Windsurf and Copilot files. */
const FILES = {
    '.ingot/rules/style.md': '---\ndescription: House style\nalwaysApply: true\n---\nUse tabs, not spaces.\n',
    '.ingot/rules/react.md': '---\ndescription: React components\nglobs: src/**/*.tsx\n---\nUse function components.\n',
    '.ingot/rules/private.md': '---\nexport: false\n---\nOnly for Ingot.\n',
    'AGENTS.md': '# Shop\n\nRun `npm test` before pushing.\n',
    '.cursor/rules/mine.mdc': '---\nalwaysApply: true\n---\nHand-written.\n',
    'src/App.tsx': 'export const App = () => null;\n'
};

const dialog = (page: Page) => page.locator('#ingot-rules-export-dialog');
const file = (page: Page, path: string) => dialog(page).locator(`#ingot-rules-export-files li[data-path="${path}"]`);

test.describe('IDEA-319 ingot export', () => {
    let base = '';
    test.afterEach(() => {
        if (base) {
            fs.rmSync(base, { recursive: true, force: true });
        }
    });

    for (const scheme of SCHEMES) {
        test(`Rules tab › Export previews and writes every tool's file (${scheme})`, async ({ page }) => {
            const made = makeRulesProject(FILES);
            base = made.base;
            await openWithScheme(page, scheme, made.repo);
            await openRulesTab(page);
            await page.locator('#ingot-mcp-rules-export').click();

            await expect(dialog(page)).toBeVisible();
            await expect(dialog(page).locator('#ingot-rules-export-status')).toContainText('will change');
            await expect(file(page, 'AGENTS.md')).toHaveAttribute('data-action', 'update');
            await expect(file(page, 'CLAUDE.md')).toHaveAttribute('data-action', 'create');
            await expect(file(page, '.cursor/rules/react.mdc')).toHaveAttribute('data-action', 'create');
            await expect(file(page, '.windsurf/rules/style.md')).toHaveAttribute('data-action', 'create');
            await expect(file(page, '.github/copilot-instructions.md')).toHaveAttribute('data-action', 'create');
            await expect(file(page, '.github/instructions/react.instructions.md')).toHaveAttribute('data-action', 'create');
            await expect(dialog(page).locator('#ingot-rules-export-files')).not.toContainText('private');
            await rulesShot(page, `export-${scheme}`);

            await dialog(page).locator('#ingot-rules-export-apply').click();
            await expect(dialog(page).locator('#ingot-rules-export-status')).toContainText('Exported');
            await expect(dialog(page).locator('#ingot-rules-export-apply')).toBeDisabled();

            const agents = readIn(made.repo, 'AGENTS.md');
            expect(agents.startsWith('# Shop\n\nRun `npm test` before pushing.\n')).toBe(true);
            expect(agents).toContain('Use tabs, not spaces.');
            expect(agents).not.toContain('Only for Ingot.');
            expect(readIn(made.repo, '.cursor/rules/react.mdc')).toContain('globs: src/**/*.tsx');
            expect(readIn(made.repo, '.windsurf/rules/react.md')).toContain('trigger: glob');
            expect(readIn(made.repo, '.github/instructions/react.instructions.md')).toContain('applyTo: "src/**/*.tsx"');
            expect(readIn(made.repo, '.cursor/rules/mine.mdc')).toBe('---\nalwaysApply: true\n---\nHand-written.\n');
            expect(existsIn(made.repo, 'CLAUDE.md')).toBe(true);
        });
    }

    test('one target only, from Find Action; removing a rule deletes its generated files', async ({ page }) => {
        const made = makeRulesProject(FILES);
        base = made.base;
        await openWithScheme(page, 'light', made.repo);
        await runCommand(page, 'Export Rules to Other Tools');
        await expect(dialog(page)).toBeVisible();
        for (const target of ['agents', 'claude', 'windsurf', 'copilot']) {
            await dialog(page).locator(`#ingot-rules-export-target-${target}`).uncheck();
        }
        await expect(file(page, 'AGENTS.md')).toHaveCount(0);
        await dialog(page).locator('#ingot-rules-export-apply').click();
        await expect(dialog(page).locator('#ingot-rules-export-status')).toContainText('Exported');
        expect(existsIn(made.repo, '.cursor/rules/style.mdc')).toBe(true);
        expect(readIn(made.repo, 'AGENTS.md')).not.toContain('Use tabs');
        await dialog(page).locator('.dialogControl button', { hasText: 'Close' }).click();

        fs.rmSync(`${made.repo}/.ingot/rules/react.md`);
        await runCommand(page, 'Export Rules to Other Tools');
        for (const target of ['agents', 'claude', 'windsurf', 'copilot']) {
            await dialog(page).locator(`#ingot-rules-export-target-${target}`).uncheck();
        }
        await expect(file(page, '.cursor/rules/react.mdc')).toHaveAttribute('data-action', 'delete');
        await dialog(page).locator('#ingot-rules-export-apply').click();
        await expect.poll(() => existsIn(made.repo, '.cursor/rules/react.mdc')).toBe(false);
        expect(existsIn(made.repo, '.cursor/rules/mine.mdc')).toBe(true);
    });
});
