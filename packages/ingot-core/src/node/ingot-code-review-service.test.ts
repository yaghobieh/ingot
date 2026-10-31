import { execFileSync } from 'child_process';
import * as fs from 'fs';
import * as http from 'http';
import type { AddressInfo } from 'net';
import * as os from 'os';
import * as path from 'path';
import { afterAll, afterEach, beforeAll, describe, expect, it } from 'vitest';
import { GH_BIN_ENV, GITHUB_API_ENV, PR_HELP, PR_NO_ACCESS } from '../common/code-review/code-review.consts';
import { parseUnifiedDiff } from '../common/code-review/code-review.utils';
import { IngotCodeReviewService } from './ingot-code-review-service';

const isWin = process.platform === 'win32';
const IDENTITY = ['-c', 'user.name=Ingot Test', '-c', 'user.email=test@ingot.invalid', '-c', 'commit.gpgsign=false', '-c', 'init.defaultBranch=main'];
const git = (cwd: string, ...args: string[]): string => execFileSync('git', [...IDENTITY, ...args], { cwd, encoding: 'utf8' });
const PR_DIFF = 'diff --git a/app.ts b/app.ts\n--- a/app.ts\n+++ b/app.ts\n@@ -1 +1 @@\n-old\n+new\n';
const ENV_KEYS = [GH_BIN_ENV, GITHUB_API_ENV, 'GH_TOKEN', 'GITHUB_TOKEN'];

describe.skipIf(isWin)('IDEA-293 code review backend', () => {
    const service = new IngotCodeReviewService();
    const saved = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));
    let dir: string;
    let server: http.Server;
    let api: string;
    const requests: { url?: string; accept?: string; auth?: string }[] = [];

    beforeAll(async () => {
        dir = fs.realpathSync(fs.mkdtempSync(path.join(os.tmpdir(), 'ingot-review-')));
        git(dir, 'init', '-q');
        fs.writeFileSync(path.join(dir, 'math.ts'), 'export const sub = (a: number, b: number): number => a - b;\n');
        git(dir, 'add', '-A');
        git(dir, 'commit', '-q', '-m', 'init');
        git(dir, 'remote', 'add', 'origin', 'https://github.com/acme/app.git');
        server = http.createServer((req, res) => {
            requests.push({ url: req.url, accept: req.headers.accept, auth: req.headers.authorization });
            res.writeHead(req.url === '/repos/acme/app/pulls/7' ? 200 : 404, { 'content-type': 'text/plain' });
            res.end(req.url === '/repos/acme/app/pulls/7' ? PR_DIFF : 'Not Found');
        });
        await new Promise<void>(resolve => server.listen(0, '127.0.0.1', resolve));
        api = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    });
    afterEach(() => {
        for (const key of ENV_KEYS) {
            if (saved[key] === undefined) {
                delete process.env[key];
            } else {
                process.env[key] = saved[key];
            }
        }
    });
    afterAll(async () => {
        await new Promise(resolve => server.close(resolve));
        fs.rmSync(dir, { recursive: true, force: true });
    });

    it('diffs staged, unstaged and untracked changes against HEAD', async () => {
        fs.writeFileSync(path.join(dir, 'math.ts'), 'export const sub = (a: number, b: number): number => b - a;\n');
        fs.writeFileSync(path.join(dir, 'new.ts'), 'export const token = 1;\n');
        const result = await service.localDiff(dir);
        expect(result.error).toBeUndefined();
        expect(parseUnifiedDiff(result.diff).map(file => [file.path, file.added])).toEqual([['math.ts', [1]], ['new.ts', [1]]]);
        git(dir, 'checkout', '--', 'math.ts');
        fs.rmSync(path.join(dir, 'new.ts'));
    });

    it('reads a PR through the gh CLI when it works', async () => {
        const gh = path.join(dir, '..', `fake-gh-${process.pid}.sh`);
        fs.writeFileSync(gh, `#!/bin/sh\n[ "$1 $2 $3" = "pr diff 12" ] && printf '%s' '${PR_DIFF}' && exit 0\nexit 1\n`, { mode: 0o755 });
        process.env[GH_BIN_ENV] = gh;
        const result = await service.pullRequestDiff(dir, '#12');
        expect(result).toEqual({ diff: PR_DIFF, label: 'PR #12 (acme/app)' });
        fs.rmSync(gh);
    });

    it('falls back to the GitHub API with the user\'s token, read-only', async () => {
        process.env[GH_BIN_ENV] = '/nonexistent/gh';
        process.env[GITHUB_API_ENV] = api;
        process.env.GH_TOKEN = ['test', 'token'].join('-');
        const result = await service.pullRequestDiff(dir, 'https://github.com/acme/app/pull/7');
        expect(result).toEqual({ diff: PR_DIFF, label: 'PR #7 (acme/app)' });
        expect(requests.at(-1)).toEqual({ url: '/repos/acme/app/pulls/7', accept: 'application/vnd.github.v3.diff', auth: 'Bearer test-token' });
    });

    it('explains what is missing', async () => {
        process.env[GH_BIN_ENV] = '/nonexistent/gh';
        delete process.env.GH_TOKEN;
        delete process.env.GITHUB_TOKEN;
        expect((await service.pullRequestDiff(dir, 'main')).error).toBe(PR_HELP);
        expect((await service.pullRequestDiff(dir, '3')).error).toBe(PR_NO_ACCESS);
    });
});
