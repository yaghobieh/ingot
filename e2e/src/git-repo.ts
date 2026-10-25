import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';

const IDENTITY = ['-c', 'user.name=Ingot E2E', '-c', 'user.email=e2e@ingot.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main'];

export const git = (cwd: string, ...args: string[]): string => execFileSync('git', [...IDENTITY, ...args], { cwd, encoding: 'utf8' });

/** A throwaway repository: two commits on `main` and a `feature/login` branch. */
export const createTempRepo = (): string => {
    const dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-git-')));
    git(dir, 'init', '-q');
    fs.mkdirSync(path.join(dir, 'src'));
    fs.writeFileSync(path.join(dir, 'src', 'math.ts'), 'export const add = (a: number, b: number): number => a + b;\n');
    fs.writeFileSync(path.join(dir, 'README.md'), '# Temp repo\n');
    git(dir, 'add', '-A');
    git(dir, 'commit', '-q', '-m', 'Initial commit');
    fs.appendFileSync(path.join(dir, 'src', 'math.ts'), 'export const sub = (a: number, b: number): number => a - b;\n');
    git(dir, 'commit', '-q', '-am', 'Add sub');
    git(dir, 'branch', 'feature/login');
    return dir;
};

export const removeTempRepo = (dir: string): void => fs.rmSync(dir, { recursive: true, force: true });
