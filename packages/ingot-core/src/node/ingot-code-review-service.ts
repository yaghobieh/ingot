import { execFile } from 'child_process';
import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { KeyStoreService } from '@theia/core/lib/common/key-store';
import {
    DIFF_MAX_BUFFER, DIFF_TIMEOUT_MS, GH_BIN_ENV, GITHUB_API_ENV, GITHUB_API_URL, GITHUB_DIFF_MEDIA_TYPE, GITHUB_JSON_MEDIA_TYPE, GITHUB_MCP_SERVER, GITHUB_MCP_TOKEN, GITHUB_TOKEN_ENVS,
    LOCAL_CHANGES_LABEL, MAX_UNTRACKED_FILES, PR_HELP, PR_NO_ACCESS
} from '../common/code-review/code-review.consts';
import type { CodeReviewService, DiffResult, PostResult } from '../common/code-review/code-review.types';
import { parsePullRequestRef } from '../common/code-review/code-review.utils';
import { githubRepoFromRemote } from '../common/agents/workspace-tools';
import { DEFAULT_KEYCHAIN_SERVICE } from '../common/models/models.consts';
import { redactSecrets } from '../common/models/models.utils';
import { mcpSecretKey } from '../common/project-config/project-config.utils';

interface RunResult {
    readonly stdout: string;
    readonly stderr: string;
    readonly code: number;
}

const GIT_DIFF = ['-c', 'core.quotepath=off', '--no-pager', 'diff', '--no-color', '--no-ext-diff'];
/** `git diff --no-index` exits 1 when the files differ, which is the normal case here. */
const DIFF_FOUND = 1;

/**
 * IDEA-293: read-only diffs for AI code review. Nothing writes to the repository; the one GitHub write is the PR comment
 * the user asks `/bugbot` to post (IDEA-287).
 */
@injectable()
export class IngotCodeReviewService implements CodeReviewService {

    @inject(KeyStoreService) @optional() protected readonly keyStore?: KeyStoreService;

    protected readonly keychain = process.env.INGOT_KEYCHAIN_SERVICE || DEFAULT_KEYCHAIN_SERVICE;

    protected run(bin: string, args: readonly string[], cwd: string, env: Readonly<Record<string, string>> = {}): Promise<RunResult> {
        return new Promise((resolve, reject) => {
            execFile(bin, [...args], { cwd, maxBuffer: DIFF_MAX_BUFFER, timeout: DIFF_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0', ...env } }, (error, stdout, stderr) => {
                const code = (error as { code?: unknown } | null)?.code;
                if (error && typeof code !== 'number') {
                    reject(error);
                    return;
                }
                resolve({ stdout, stderr, code: typeof code === 'number' ? code : 0 });
            });
        });
    }

    async localDiff(root: string): Promise<DiffResult> {
        const head = await this.run('git', ['rev-parse', '--verify', '--quiet', 'HEAD'], root);
        const tracked = await this.run('git', head.code === 0 ? [...GIT_DIFF, 'HEAD'] : [...GIT_DIFF, '--cached'], root);
        if (tracked.code !== 0) {
            return { diff: '', label: LOCAL_CHANGES_LABEL, error: tracked.stderr.trim() || 'Not a git repository.' };
        }
        const listed = await this.run('git', ['ls-files', '--others', '--exclude-standard', '-z'], root);
        const untracked = listed.stdout.split('\0').filter(Boolean).slice(0, MAX_UNTRACKED_FILES);
        const added: string[] = [];
        for (const file of untracked) {
            const diff = await this.run('git', [...GIT_DIFF, '--no-index', '--', '/dev/null', file], root);
            if (diff.code === 0 || diff.code === DIFF_FOUND) {
                added.push(diff.stdout);
            }
        }
        return { diff: [tracked.stdout, ...added].filter(text => text.trim()).join('\n'), label: LOCAL_CHANGES_LABEL };
    }

    async pullRequestDiff(root: string, ref: string): Promise<DiffResult> {
        const pr = parsePullRequestRef(ref);
        if (!pr) {
            return { diff: '', label: ref.trim(), error: PR_HELP };
        }
        const gh = process.env[GH_BIN_ENV] || 'gh';
        const viaCli = await this.run(gh, ['pr', 'diff', String(pr.number), ...(pr.repo ? ['--repo', pr.repo] : []), '--color', 'never'], root, { GH_PROMPT_DISABLED: '1', NO_COLOR: '1' })
            .catch(() => undefined);
        const repo = pr.repo ?? await this.originRepo(root);
        const label = `PR #${pr.number}${repo ? ` (${repo})` : ''}`;
        if (viaCli?.code === 0 && viaCli.stdout.trim()) {
            return { diff: viaCli.stdout, label };
        }
        const token = await this.token();
        if (!repo || !token) {
            return { diff: '', label, error: PR_NO_ACCESS };
        }
        const api = (process.env[GITHUB_API_ENV] || GITHUB_API_URL).replace(/\/+$/, '');
        try {
            const response = await fetch(`${api}/repos/${repo}/pulls/${pr.number}`, {
                headers: { accept: GITHUB_DIFF_MEDIA_TYPE, authorization: `Bearer ${token}`, 'user-agent': 'Ingot IDE' },
                signal: AbortSignal.timeout(DIFF_TIMEOUT_MS)
            });
            const body = await response.text();
            return response.ok ? { diff: body, label } : { diff: '', label, error: `GitHub returned ${response.status} for ${repo}#${pr.number}. ${PR_NO_ACCESS}` };
        } catch (error) {
            return { diff: '', label, error: redactSecrets(error instanceof Error ? error.message : String(error), [token]) };
        }
    }

    async postPullRequestComment(root: string, ref: string, body: string): Promise<PostResult> {
        const pr = parsePullRequestRef(ref);
        if (!pr || !body.trim()) {
            return { ok: false, error: PR_HELP };
        }
        const gh = process.env[GH_BIN_ENV] || 'gh';
        const viaCli = await this.run(gh, ['pr', 'comment', String(pr.number), ...(pr.repo ? ['--repo', pr.repo] : []), '--body', body], root, { GH_PROMPT_DISABLED: '1', NO_COLOR: '1' })
            .catch(() => undefined);
        if (viaCli?.code === 0) {
            const url = /https?:\/\/\S+/.exec(viaCli.stdout)?.[0];
            return { ok: true, ...(url ? { url } : {}) };
        }
        const repo = pr.repo ?? await this.originRepo(root);
        const token = await this.token();
        if (!repo || !token) {
            return { ok: false, error: PR_NO_ACCESS };
        }
        const api = (process.env[GITHUB_API_ENV] || GITHUB_API_URL).replace(/\/+$/, '');
        try {
            const response = await fetch(`${api}/repos/${repo}/issues/${pr.number}/comments`, {
                method: 'POST',
                headers: { accept: GITHUB_JSON_MEDIA_TYPE, authorization: `Bearer ${token}`, 'content-type': 'application/json', 'user-agent': 'Ingot IDE' },
                body: JSON.stringify({ body }),
                signal: AbortSignal.timeout(DIFF_TIMEOUT_MS)
            });
            const json = await response.json().catch(() => ({})) as { html_url?: unknown };
            return response.ok
                ? { ok: true, ...(typeof json.html_url === 'string' ? { url: json.html_url } : {}) }
                : { ok: false, error: `GitHub returned ${response.status} for ${repo}#${pr.number}. ${PR_NO_ACCESS}` };
        } catch (error) {
            return { ok: false, error: redactSecrets(error instanceof Error ? error.message : String(error), [token]) };
        }
    }

    protected async originRepo(root: string): Promise<string | undefined> {
        const remote = await this.run('git', ['remote', 'get-url', 'origin'], root).catch(() => undefined);
        const repo = githubRepoFromRemote(remote?.code === 0 ? remote.stdout.trim() : undefined);
        return repo ? `${repo.owner}/${repo.repo}` : undefined;
    }

    /** The user's GitHub token: `GH_TOKEN` / `GITHUB_TOKEN`, else the GitHub MCP server's token from the key store. */
    protected async token(): Promise<string | undefined> {
        const fromEnv = GITHUB_TOKEN_ENVS.map(name => process.env[name]).find(value => !!value?.trim());
        if (fromEnv) {
            return fromEnv.trim();
        }
        return (await this.keyStore?.getPassword(this.keychain, mcpSecretKey(GITHUB_MCP_SERVER, GITHUB_MCP_TOKEN)).catch(() => undefined)) || undefined;
    }
}
