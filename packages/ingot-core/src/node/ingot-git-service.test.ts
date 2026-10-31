import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { IngotGitService } from './ingot-git-service';

const isWin = process.platform === 'win32';
const IDENTITY = ['-c', 'user.name=Ingot Test', '-c', 'user.email=test@ingot.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main'];
const git = (cwd: string, ...args: string[]): string => execFileSync('git', [...IDENTITY, ...args], { cwd, encoding: 'utf8' });
const write = (dir: string, file: string, text: string): void => {
    fs.mkdirSync(path.dirname(path.join(dir, file)), { recursive: true });
    fs.writeFileSync(path.join(dir, file), text);
};

describe.skipIf(isWin)('IDEA-287 worktrees.json setup in a new worktree', () => {
    const service = new IngotGitService();
    let dir: string;
    let folder: string;

    beforeEach(async () => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-worktree-setup-')));
        git(dir, 'init', '-q');
        write(dir, 'README.md', 'repo\n');
        git(dir, 'add', '.');
        git(dir, 'commit', '-qm', 'init');
        folder = (await service.addWorktree(dir, `setup-${path.basename(dir).slice(-6).toLowerCase()}`)).folder;
    });

    afterEach(() => {
        execFileSync('git', ['worktree', 'remove', '--force', folder], { cwd: dir });
        fs.rmSync(path.dirname(folder), { recursive: true, force: true });
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('runs the main checkout\'s .cursor/worktrees.json commands in the worktree with ROOT_WORKTREE_PATH', async () => {
        write(dir, '.cursor/worktrees.json', JSON.stringify({ 'setup-worktree': ['echo "$ROOT_WORKTREE_PATH" > root.txt', 'echo second > second.txt'] }));
        const result = await service.setupWorktree(dir, folder, true);
        expect(result).toMatchObject({ source: '.cursor/worktrees.json', ran: 2, ok: true });
        expect(fs.readFileSync(path.join(folder, 'root.txt'), 'utf8').trim()).toBe(dir);
        expect(fs.existsSync(path.join(folder, 'second.txt'))).toBe(true);
        expect(await service.setupWorktree(dir, folder, false)).toBeUndefined();
    });

    it('prefers the worktree\'s own .ingot file, runs a script path, and stops at the first failing command', async () => {
        write(folder, '.ingot/setup.sh', 'echo from-script > script.txt\n');
        write(folder, '.ingot/worktrees.json', JSON.stringify({ 'setup-worktree-unix': 'setup.sh' }));
        write(dir, '.cursor/worktrees.json', JSON.stringify({ 'setup-worktree': ['echo wrong > wrong.txt'] }));
        expect(await service.setupWorktree(dir, folder, true)).toMatchObject({ source: '.ingot/worktrees.json', ran: 1, ok: true });
        expect(fs.readFileSync(path.join(folder, 'script.txt'), 'utf8').trim()).toBe('from-script');
        expect(fs.existsSync(path.join(folder, 'wrong.txt'))).toBe(false);

        write(folder, '.ingot/worktrees.json', JSON.stringify({ 'setup-worktree': ['exit 3', 'echo never > never.txt'] }));
        const failed = await service.setupWorktree(dir, folder, true);
        expect(failed).toMatchObject({ ran: 1, ok: false });
        expect(failed?.error).toContain('exit 3');
        expect(fs.existsSync(path.join(folder, 'never.txt'))).toBe(false);
    });
});
