import { execFile } from 'child_process';
import * as fs from 'fs';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import { BRANCH_FORMAT, LOG_FORMAT } from '../common/git/git.consts';
import type { GitBranch, GitCommit, GitFileChange, GitService } from '../common/git/git.types';
import { isRepoRelativePath, isValidBranchName, isValidRevision, parseBranches, parseLog, parseNameStatus } from '../common/git/git.utils';

const GIT_TIMEOUT_MS = 15_000;
const MAX_BUFFER = 16 * 1024 * 1024;

/** Runs a fixed set of git commands with validated arguments (no shell). */
@injectable()
export class IngotGitService implements GitService {

    protected git(root: string, args: string[]): Promise<string> {
        if (!path.isAbsolute(root) || !fs.existsSync(root)) {
            return Promise.reject(new Error('Not a folder on this machine.'));
        }
        return new Promise((resolve, reject) => {
            execFile('git', ['-c', 'core.quotepath=off', ...args], { cwd: root, timeout: GIT_TIMEOUT_MS, maxBuffer: MAX_BUFFER, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } },
                (error, stdout, stderr) => error ? reject(new Error((stderr || error.message).trim().split('\n').pop())) : resolve(stdout));
        });
    }

    async branches(root: string): Promise<GitBranch[]> {
        return parseBranches(await this.git(root, ['for-each-ref', `--format=${BRANCH_FORMAT}`, 'refs/heads', 'refs/remotes']));
    }

    async checkout(root: string, branch: string): Promise<void> {
        if (!isValidBranchName(branch)) {
            throw new Error(`Invalid branch name "${branch}".`);
        }
        const local = (await this.branches(root)).some(b => !b.remote && b.name === branch);
        const remote = branch.includes('/') ? branch.slice(branch.indexOf('/') + 1) : undefined;
        if (!local && remote && (await this.branches(root)).some(b => b.remote && b.name === branch)) {
            // Checking out a remote branch creates a local tracking branch, like IntelliJ's "Checkout".
            await this.git(root, ['checkout', '--track', branch]);
            return;
        }
        await this.git(root, ['checkout', branch, '--']);
    }

    async createBranch(root: string, name: string): Promise<void> {
        if (!isValidBranchName(name)) {
            throw new Error(`Invalid branch name "${name}".`);
        }
        await this.git(root, ['checkout', '-b', name]);
    }

    async log(root: string, limit: number, file?: string): Promise<GitCommit[]> {
        if (file !== undefined && !isRepoRelativePath(file)) {
            throw new Error('Invalid path.');
        }
        const args = ['log', `--max-count=${Math.max(1, Math.min(limit, 2000))}`, `--format=${LOG_FORMAT}`, '--decorate=short'];
        try {
            return parseLog(await this.git(root, file ? [...args, '--follow', '--', file] : args));
        } catch (error) {
            // A repository without commits has no log.
            if (/does not have any commits|bad default revision/.test(String(error))) {
                return [];
            }
            throw error;
        }
    }

    async changes(root: string, hash: string): Promise<GitFileChange[]> {
        if (!isValidRevision(hash)) {
            throw new Error('Invalid revision.');
        }
        return parseNameStatus(await this.git(root, ['diff-tree', '--no-commit-id', '--name-status', '-r', '-M', '--root', hash]));
    }

    async show(root: string, ref: string, file: string): Promise<string | undefined> {
        if (!isValidRevision(ref) || !isRepoRelativePath(file)) {
            throw new Error('Invalid revision or path.');
        }
        try {
            return await this.git(root, ['show', `${ref}:${file}`]);
        } catch {
            return undefined;
        }
    }
}
