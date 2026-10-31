import { execFile } from 'child_process';
import { HOOKS_RAN_ENV } from '../common/git/hooks';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { gitArgs, rewordTodo, type GitOperation, type GitOpResult } from '../common/git/git-ops';
import { injectable } from '@theia/core/shared/inversify';
import { BRANCH_FORMAT, LOG_FORMAT } from '../common/git/git.consts';
import type { GitBlameLine, GitBranch, GitCommit, GitFileChange, GitService } from '../common/git/git.types';
import { cloneTarget, isCloneUrl } from '../common/welcome/welcome.utils';
import { isRepoRelativePath, isValidBranchName, isValidRef, parseBlame, parseBranches, parseLog, parseNameStatus } from '../common/git/git.utils';
import { isValidWorktreeName, worktreeBranch, worktreeFolder } from '../common/threads/threads.utils';
import type { WorktreeCreated } from '../common/threads/threads.types';

const GIT_TIMEOUT_MS = 15_000;
const CLONE_TIMEOUT_MS = 10 * 60_000;
const MAX_BUFFER = 16 * 1024 * 1024;
/** IDEA-291: subagent worktrees live under the OS temp folder, never inside the project. */
const WORKTREES_DIR = 'ingot-worktrees';

/** Runs a fixed set of git commands with validated arguments (no shell). */
/** IDEA-178: tells the installed git hook that Ingot already ran the agent hooks. */
const hooksRanEnv = (ran: boolean | undefined): { env?: Record<string, string> } => ran ? { env: { [HOOKS_RAN_ENV]: '1' } } : {};

@injectable()
export class IngotGitService implements GitService {

    protected git(root: string, args: string[], options: { env?: Record<string, string>; input?: string; timeout?: number } = {}): Promise<string> {
        if (!path.isAbsolute(root) || !fs.existsSync(root)) {
            return Promise.reject(new Error('Not a folder on this machine.'));
        }
        return new Promise((resolve, reject) => {
            const child = execFile('git', ['-c', 'core.quotepath=off', ...args],
                { cwd: root, timeout: options.timeout ?? GIT_TIMEOUT_MS, maxBuffer: MAX_BUFFER, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...options.env } },
                (error, stdout, stderr) => error ? reject(new Error((stderr || error.message).trim().split('\n').filter(Boolean).slice(-2).join(' '))) : resolve(stdout));
            if (options.input !== undefined) {
                child.stdin?.end(options.input);
            }
        });
    }

    /** A small node script used as GIT_SEQUENCE_EDITOR / GIT_EDITOR for non-interactive rebases. */
    protected editorScript(name: string, body: string): string {
        const file = path.join(os.tmpdir(), `ingot-git-${process.pid}-${name}.js`);
        fs.writeFileSync(file, body);
        return `"${process.execPath}" "${file}"`;
    }

    async run(root: string, op: GitOperation): Promise<GitOpResult> {
        const args = gitArgs(op);
        const remoteTimeout = { timeout: 120_000 };
        switch (op.kind) {
            case 'apply':
                return { output: await this.git(root, args, { input: op.patch }) };
            case 'pull': case 'fetch':
                return { output: await this.git(root, args, remoteTimeout) };
            case 'push': case 'pushTo':
                return { output: await this.git(root, args, { ...remoteTimeout, ...hooksRanEnv(op.hooksRan) }) };
            case 'commit':
                return { output: await this.git(root, args, { input: op.message, timeout: 120_000, ...hooksRanEnv(op.hooksRan) }) };
            case 'chmodHook': {
                const hook = path.resolve(root, (await this.git(root, args)).trim());
                if (!/[\\/]hooks[\\/](pre-commit|pre-push)$/.test(hook) || !fs.existsSync(hook)) {
                    throw new Error('No Ingot hook to make executable.');
                }
                fs.chmodSync(hook, 0o755);
                return { output: hook };
            }
            case 'stageContent': {
                const sha = (await this.git(root, args, { input: op.content })).trim();
                const staged = (await this.git(root, ['ls-files', '-s', '--', op.path])).trim();
                const mode = /^(\d{6}) /.exec(staged)?.[1] ?? '100644';
                await this.git(root, ['update-index', '--add', '--cacheinfo', `${mode},${sha},${op.path}`]);
                return { output: sha };
            }
            case 'outgoing': case 'recentMessages': case 'headMessage':
                // A repository without commits has nothing to push or recall.
                return { output: await this.git(root, args).catch(() => '') };
            case 'upstream':
                return { output: (await this.git(root, args).catch(() => '')).trim() };
            case 'isAncestorOfHead':
                return { output: await this.git(root, args).then(() => 'yes', () => 'no') };
            case 'worktreeAdd': {
                const parent = path.join(fs.realpathSync(os.tmpdir()), WORKTREES_DIR);
                fs.mkdirSync(parent, { recursive: true });
                const folder = path.join(parent, `${path.basename(root).replace(/[^\w.-]+/g, '-')}-${args[args.length - 1]}`);
                await this.git(root, [...args.slice(0, -1), folder, 'HEAD'], { timeout: 120_000 });
                return { output: folder };
            }
            case 'reword': {
                const head = (await this.git(root, ['rev-parse', 'HEAD'])).trim();
                const target = (await this.git(root, ['rev-parse', op.commit])).trim();
                if (head === target) {
                    return { output: await this.git(root, ['commit', '--amend', '--only', '-m', op.message]) };
                }
                const short = (await this.git(root, ['rev-parse', '--short=7', target])).trim();
                const sequence = this.editorScript('sequence', `const fs=require('fs');const f=process.argv[2];const t=fs.readFileSync(f,'utf8');fs.writeFileSync(f,(${rewordTodo.toString()})(t,process.env.INGOT_REWORD_SHORT));`);
                const editor = this.editorScript('message', `require('fs').writeFileSync(process.argv[2],process.env.INGOT_REWORD_MESSAGE+'\\n');`);
                return { output: await this.git(root, ['-c', `core.abbrev=7`, ...args], { env: { GIT_SEQUENCE_EDITOR: sequence, GIT_EDITOR: editor, INGOT_REWORD_SHORT: short, INGOT_REWORD_MESSAGE: op.message } }) };
            }
            case 'fixup': {
                const out = await this.git(root, args);
                const accept = this.editorScript('accept', '');
                return { output: out + await this.git(root, ['rebase', '-i', '--autosquash', `${op.commit}~1`], { env: { GIT_SEQUENCE_EDITOR: accept, GIT_EDITOR: accept } }) };
            }
            default:
                return { output: await this.git(root, args) };
        }
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
            // Checking out a remote branch creates a local tracking branch, like classic IDE "Checkout".
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
        if (!isValidRef(hash)) {
            throw new Error('Invalid revision.');
        }
        return parseNameStatus(await this.git(root, ['diff-tree', '--no-commit-id', '--name-status', '-r', '-M', '--root', hash]));
    }

    async show(root: string, ref: string, file: string): Promise<string | undefined> {
        if (!isValidRef(ref) || !isRepoRelativePath(file)) {
            throw new Error('Invalid revision or path.');
        }
        try {
            return await this.git(root, ["show", `${ref}:./${file}`]);
        } catch {
            return undefined;
        }
    }

    protected checkPath(file: string): void {
        if (!isRepoRelativePath(file)) {
            throw new Error('Invalid path.');
        }
    }

    async commitFile(root: string, file: string, message: string): Promise<void> {
        this.checkPath(file);
        if (!message.trim()) {
            throw new Error('A commit message is required.');
        }
        await this.git(root, ['add', '--', file]);
        await this.git(root, ['commit', '-m', message, '--', file]);
    }

    async rollbackFile(root: string, file: string): Promise<void> {
        this.checkPath(file);
        await this.git(root, ['checkout', 'HEAD', '--', file]);
    }

    async blame(root: string, file: string): Promise<GitBlameLine[]> {
        this.checkPath(file);
        return parseBlame(await this.git(root, ['blame', '--line-porcelain', '--', file]));
    }

    /** IDEA-165: `git clone -- <url> <parent>/<repo>`; refuses odd URLs and existing targets. */
    async clone(url: string, parent: string): Promise<string> {
        const value = url.trim();
        if (!isCloneUrl(value)) {
            throw new Error('Enter an https or ssh Git URL.');
        }
        const target = cloneTarget(parent, value);
        if (fs.existsSync(target)) {
            throw new Error(`${target} already exists.`);
        }
        await this.git(parent, ['clone', '--', value, target], { timeout: CLONE_TIMEOUT_MS });
        return target;
    }

    async addWorktree(root: string, name: string): Promise<WorktreeCreated> {
        if (!isValidWorktreeName(name)) {
            throw new Error(`Invalid worktree name "${name}".`);
        }
        const top = (await this.git(root, ['rev-parse', '--show-toplevel'])).trim();
        const folder = worktreeFolder(path.normalize(top), name);
        if (fs.existsSync(folder)) {
            throw new Error(`${folder} already exists.`);
        }
        const branch = worktreeBranch(name);
        await this.git(top, ['worktree', 'add', '-b', branch, '--', folder, 'HEAD']);
        return { folder, branch };
    }

    async remote(root: string): Promise<{ url: string; commit: string; branch?: string } | undefined> {
        try {
            const url = (await this.git(root, ['remote', 'get-url', 'origin'])).trim();
            const commit = (await this.git(root, ['rev-parse', 'HEAD'])).trim();
            const branch = (await this.git(root, ['rev-parse', '--abbrev-ref', 'HEAD'])).trim();
            return { url, commit, branch: branch === 'HEAD' ? undefined : branch };
        } catch {
            return undefined;
        }
    }
}
