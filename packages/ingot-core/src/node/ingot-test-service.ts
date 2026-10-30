import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { injectable } from '@theia/core/shared/inversify';
import {
    DISCOVERY_SKIPPED_DIRS, MAX_DISCOVERY_DEPTH, MAX_TEST_FILE_BYTES, MAX_TEST_FILES, NO_RUNNER_TEXT, RUN_OUTPUT_BUFFER_CHARS, RUN_OUTPUT_TAIL_CHARS, TEST_RUN_TIMEOUT_MS
} from '../common/testing/testing.consts';
import type { RunnerCommand, TestDiscovery, TestFile, TestRunner, TestRunRequest, TestRunResult, TestService } from '../common/testing/testing.types';
import { commandLine, detectRunner, discoverTests, extractJson, isTestFile, parseReport, runError, runnerCommand, scopeToRequest, summarizeRun } from '../common/testing/testing.utils';

const REPORT_FILE = 'report.json';
const IS_WINDOWS = process.platform === 'win32';

/** IDEA-261: finds the project's tests and runs them with its runner, reading the runner's JSON report. */
@injectable()
export class IngotTestService implements TestService {

    /** One run per project at a time; later runs wait for the earlier one. */
    protected readonly queues = new Map<string, Promise<unknown>>();

    async discover(root: string): Promise<TestDiscovery> {
        const { runner, reason } = await this.detect(root);
        const files: TestFile[] = [];
        const walk = async (dir: string, depth: number): Promise<void> => {
            const entries = await fs.promises.readdir(dir, { withFileTypes: true }).catch(() => []);
            for (const entry of entries.sort((a, b) => a.name.localeCompare(b.name))) {
                if (files.length >= MAX_TEST_FILES) {
                    return;
                }
                const abs = path.join(dir, entry.name);
                if (entry.isDirectory()) {
                    if (depth < MAX_DISCOVERY_DEPTH && !DISCOVERY_SKIPPED_DIRS.has(entry.name) && !entry.name.startsWith('.')) {
                        await walk(abs, depth + 1);
                    }
                    continue;
                }
                const rel = path.relative(root, abs).split(path.sep).join('/');
                if (!entry.isFile() || !isTestFile(rel, runner)) {
                    continue;
                }
                const stat = await fs.promises.stat(abs).catch(() => undefined);
                const source = stat && stat.size <= MAX_TEST_FILE_BYTES ? await fs.promises.readFile(abs, 'utf8').catch(() => '') : '';
                files.push({ path: rel, tests: discoverTests(rel, source) });
            }
        };
        await walk(root, 0);
        return { ...(runner ? { runner, reason } : {}), files };
    }

    run(root: string, request: TestRunRequest): Promise<TestRunResult> {
        const previous = this.queues.get(root) ?? Promise.resolve();
        const next = previous.catch(() => undefined).then(() => this.runNow(root, request));
        this.queues.set(root, next);
        void next.finally(() => {
            if (this.queues.get(root) === next) {
                this.queues.delete(root);
            }
        });
        return next;
    }

    protected async detect(root: string): Promise<{ runner?: TestRunner; reason?: string }> {
        const [files, packageJson] = await Promise.all([
            fs.promises.readdir(root).catch(() => [] as string[]),
            fs.promises.readFile(path.join(root, 'package.json'), 'utf8').catch(() => '')
        ]);
        return detectRunner({ files, packageJson });
    }

    protected async runNow(root: string, request: TestRunRequest): Promise<TestRunResult> {
        const { runner } = await this.detect(root);
        if (!runner) {
            return runError(undefined, NO_RUNNER_TEXT);
        }
        const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ingot-tests-'));
        const report = path.join(dir, REPORT_FILE);
        const command = runnerCommand(runner, request, report);
        const shown = commandLine(command);
        try {
            const bin = this.findBin(root, command.bin);
            const started = Date.now();
            const { code, output, error } = await this.spawn(root, bin, command);
            const durationMs = Date.now() - started;
            const tail = output.trim().slice(-RUN_OUTPUT_TAIL_CHARS);
            if (error) {
                return runError(runner, `${shown}: ${error}`, shown);
            }
            const raw = await fs.promises.readFile(report, 'utf8').then(text => JSON.parse(text) as unknown, () => extractJson(output));
            const tests = parseReport(runner, raw, root);
            if (!tests) {
                return runError(runner, `${shown} exited with code ${code ?? '?'} without a report.${tail ? `\n${tail}` : ''}`, shown);
            }
            return summarizeRun(runner, scopeToRequest(tests, request), durationMs, code, shown, tail);
        } finally {
            await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
        }
    }

    /** The runner from the nearest node_modules/.bin (monorepos hoist it), else npx. */
    protected findBin(root: string, bin: string): { cmd: string; prefix: readonly string[] } {
        const name = IS_WINDOWS ? `${bin}.cmd` : bin;
        for (let dir = root; ; dir = path.dirname(dir)) {
            const candidate = path.join(dir, 'node_modules', '.bin', name);
            if (fs.existsSync(candidate)) {
                return { cmd: candidate, prefix: [] };
            }
            if (path.dirname(dir) === dir) {
                return { cmd: IS_WINDOWS ? 'npx.cmd' : 'npx', prefix: ['--no-install', bin] };
            }
        }
    }

    protected spawn(cwd: string, bin: { cmd: string; prefix: readonly string[] }, command: RunnerCommand): Promise<{ code?: number; output: string; error?: string }> {
        return new Promise(resolve => {
            let output = '';
            const child = spawn(bin.cmd, [...bin.prefix, ...command.args], {
                cwd, shell: IS_WINDOWS, stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, ...command.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' }
            });
            const add = (chunk: Buffer): void => {
                output = `${output}${chunk.toString('utf8')}`.slice(-RUN_OUTPUT_BUFFER_CHARS);
            };
            child.stdout.on('data', add);
            child.stderr.on('data', add);
            const timer = setTimeout(() => child.kill('SIGTERM'), TEST_RUN_TIMEOUT_MS);
            child.on('error', error => {
                clearTimeout(timer);
                resolve({ output, error: error.message });
            });
            child.on('close', (code, signal) => {
                clearTimeout(timer);
                resolve(signal ? { output, error: `stopped (${signal})` } : { code: code ?? undefined, output });
            });
        });
    }
}
