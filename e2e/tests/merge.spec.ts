import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { expect, test, type Page } from '@playwright/test';
import { actUntilVisible, dismissNotifications, openIngot } from '../src/app.utils';
import { startFakeOllama } from '../src/fake-ollama';
import { connectOllama } from '../src/models.e2e-utils';

/** IDEA-33: conflicts dialog, three-pane merge tool, Accept Yours/Theirs, AI proposal shown as a diff. */
const git = (cwd: string, ...args: string[]): string => execFileSync('git', args, { cwd, encoding: 'utf8' });
const BASE = 'a\nb\nc\nd\ne\n';

const conflictRepo = (): string => {
    const repo = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-merge-')));
    git(repo, 'init', '-q', '-b', 'main');
    git(repo, 'config', 'user.email', 'e2e@ingot.dev');
    git(repo, 'config', 'user.name', 'E2E Bot');
    fs.writeFileSync(path.join(repo, 'a.txt'), BASE);
    fs.writeFileSync(path.join(repo, 'x.txt'), 'x\n');
    git(repo, 'add', '.');
    git(repo, 'commit', '-q', '-m', 'Base');
    git(repo, 'checkout', '-q', '-b', 'feature');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\nB-theirs\nc\nd\ne\nf\n');
    fs.writeFileSync(path.join(repo, 'x.txt'), 'x-theirs\n');
    git(repo, 'commit', '-q', '-am', 'Theirs');
    git(repo, 'checkout', '-q', 'main');
    fs.writeFileSync(path.join(repo, 'a.txt'), 'a\nB-ours\nc\nD-ours\ne\n');
    fs.writeFileSync(path.join(repo, 'x.txt'), 'x-ours\n');
    git(repo, 'commit', '-q', '-am', 'Ours');
    try {
        git(repo, 'merge', 'feature');
    } catch {
        // expected: conflicts
    }
    return repo;
};

const unmerged = (repo: string): string => git(repo, 'diff', '--name-only', '--diff-filter=U').trim();

const openConflicts = async (page: Page): Promise<void> => {
    await actUntilVisible(() => page.keyboard.press('Control+k'), page.locator('#ingot-lc-resolve'));
    await page.locator('#ingot-lc-resolve').click();
    await expect(page.locator('.ingot-conflicts-table tbody tr')).toHaveCount(2);
};

test.describe('IDEA-33 merge conflicts', () => {
    let repo: string;
    test.beforeEach(() => { repo = conflictRepo(); });
    test.afterEach(() => fs.rmSync(repo, { recursive: true, force: true }));

    test('merge tool: apply non-conflicting, » takes yours for the conflict, Apply marks it resolved; Accept Theirs for the rest', async ({ page }) => {
        expect(unmerged(repo).split('\n').sort()).toEqual(['a.txt', 'x.txt']);
        await openIngot(page, repo);
        await dismissNotifications(page);
        await openConflicts(page);
        await page.locator('.ingot-conflicts-table tr[data-path="a.txt"]').click();
        await page.locator('#ingot-conflicts-merge').click();

        const merge = page.locator('.ingot-merge');
        await expect(merge.locator('#ingot-merge-status')).toHaveText('1 conflict · 2 changes left', { timeout: 15_000 });
        await expect(merge.locator('.ingot-merge-pane-title').first()).toContainText('main');
        await merge.locator('#ingot-merge-apply-nonconflicting').click();
        await expect(merge.locator('#ingot-merge-status')).toHaveText('1 conflict');
        await expect(merge.locator('.ingot-merge-result .view-lines')).toContainText('D-ours');
        await expect(merge.locator('.ingot-merge-result .view-lines')).toContainText('f');

        await merge.locator('.ingot-merge-yours .ingot-merge-apply').first().click();
        await expect(merge.locator('#ingot-merge-status')).toHaveText('All conflicts resolved');
        expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toContain('<<<<<<<');
        await merge.locator('#ingot-merge-save').click();
        await expect.poll(() => fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('a\nB-ours\nc\nD-ours\ne\nf\n');
        await expect.poll(() => unmerged(repo)).toBe('x.txt');

        // The conflicts dialog comes back with the remaining file: Accept Theirs.
        await expect(page.locator('.ingot-conflicts-table tbody tr')).toHaveCount(1);
        await page.locator('#ingot-conflicts-theirs').click();
        await expect.poll(() => unmerged(repo)).toBe('');
        expect(fs.readFileSync(path.join(repo, 'x.txt'), 'utf8')).toBe('x-theirs\n');
        await expect(page.locator('#ingot-lc-resolve')).toHaveCount(0);
    });

    test('Accept Yours from the conflicts dialog; double-click a conflicted file opens the merge tool', async ({ page }) => {
        await openIngot(page, repo);
        await dismissNotifications(page);
        await openConflicts(page);
        await page.locator('.ingot-conflicts-table tr[data-path="x.txt"]').click();
        await page.locator('#ingot-conflicts-ours').click();
        await expect.poll(() => unmerged(repo)).toBe('a.txt');
        expect(fs.readFileSync(path.join(repo, 'x.txt'), 'utf8')).toBe('x-ours\n');
        await page.locator('#ingot-conflicts-close').click().catch(() => undefined);
        await page.locator('.ingot-lc-file[data-path="a.txt"]').dblclick();
        await expect(page.locator('.ingot-merge #ingot-merge-status')).toContainText('1 conflict');
        await page.locator('#ingot-merge-accept-theirs').click();
        await expect.poll(() => unmerged(repo)).toBe('');
        expect(fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe('a\nB-theirs\nc\nd\ne\nf\n');
    });

    test('Resolve with AI shows the proposal as a diff and applies it only on request', async ({ page }) => {
        const merged = 'a\nB-ours and B-theirs\nc\nD-ours\ne\nf\n';
        const server = await startFakeOllama(system => system.includes('merge conflicts') ? `Here you go:\n\`\`\`\n${merged}\`\`\`` : 'ok');
        try {
            await openIngot(page, repo);
            await dismissNotifications(page);
            await connectOllama(page, server);
            await openConflicts(page);
            await page.locator('.ingot-conflicts-table tr[data-path="a.txt"]').click();
            await page.locator('#ingot-conflicts-merge').click();
            const merge = page.locator('.ingot-merge');
            await expect(merge.locator('#ingot-merge-status')).toContainText('1 conflict');
            await merge.locator('#ingot-merge-ai').click();
            await expect(merge.locator('#ingot-merge-proposal')).toBeVisible();
            expect(server.requests.at(-1)?.user).toContain('B-ours');
            expect(server.requests.at(-1)?.user).toContain('B-theirs');
            await expect(merge.locator('#ingot-merge-proposal .editor.modified .view-lines')).toContainText('B-ours and B-theirs');
            await expect(merge.locator('.ingot-merge-result .view-lines')).not.toContainText('B-ours and B-theirs');
            await merge.locator('#ingot-merge-proposal-apply').click();
            await expect(merge.locator('#ingot-merge-proposal')).toBeHidden();
            await expect(merge.locator('#ingot-merge-status')).toHaveText('All conflicts resolved');
            await merge.locator('#ingot-merge-save').click();
            await expect.poll(() => fs.readFileSync(path.join(repo, 'a.txt'), 'utf8')).toBe(merged);
        } finally {
            await server.close();
        }
    });
});
