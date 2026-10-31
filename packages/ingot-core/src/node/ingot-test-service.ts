import { spawn } from 'child_process';
import * as fs from 'fs';
import * as os from 'os';
import * as path from 'path';
import { inject, injectable, optional } from '@theia/core/shared/inversify';
import {
    DISCOVERY_SKIPPED_DIRS, MAX_DISCOVERY_DEPTH, MAX_TEST_FILE_BYTES, MAX_TEST_FILES, NO_RUNNER_TEXT, RUN_OUTPUT_BUFFER_CHARS, RUN_OUTPUT_TAIL_CHARS, TEST_RUN_TIMEOUT_MS
} from '../common/testing/testing.consts';
import type {
    JsTestRunner, LanguageTestRunner, ProjectManifest, RunnerCommand, TestDiscovery, TestFile, TestRunner, TestRunRequest, TestRunResult, TestService
} from '../common/testing/testing.types';
import { commandLine, detectRunner, discoverTests, extractJson, parseReport, runError, runnerCommand, scopeToRequest, summarizeRun } from '../common/testing/testing.utils';
import { LANGUAGE_OUTPUT_BUFFER_CHARS, RUNNER_MANIFESTS } from '../common/testing/language-tests.consts';
import {
    detectLanguageRunner, discoverLanguageTests, filterToRequest, isLanguageRunner, isRunnerTestFile, languageRunnerCommand, languageRunnerSpec, matchToDiscovered,
    parseLanguageReport, runnerHint
} from '../common/testing/language-tests.utils';
import { languageById, missingToolchainMessage, isUsable } from '../common/languages/languages.utils';
import { guidePlatform } from '../common/debug/debug.utils';
import { IngotToolchainService } from './languages/ingot-toolchain-service';

const REPORT_FILE = 'report.json';
const IS_WINDOWS = process.platform === 'win32';
/** File systems with coarse timestamps: a report written in the run's first second still counts. */
const TIMESTAMP_SLACK_MS = 2_000;

interface SpawnResult {
    readonly code?: number;
    readonly output: string;
    readonly error?: string;
}

interface Bin {
    readonly cmd: string;
    readonly prefix: readonly string[];
}

/** IDEA-261: finds the project's tests and runs them with its runner, reading the runner's report. IDEA-313: every bundled language's runner too. */
@injectable()
export class IngotTestService implements TestService {

    @inject(IngotToolchainService) @optional() protected readonly toolchains?: IngotToolchainService;

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
                if (!entry.isFile() || !isRunnerTestFile(rel, runner)) {
                    continue;
                }
                const stat = await fs.promises.stat(abs).catch(() => undefined);
                const source = stat && stat.size <= MAX_TEST_FILE_BYTES ? await fs.promises.readFile(abs, 'utf8').catch(() => '') : '';
                const tests = isLanguageRunner(runner) ? discoverLanguageTests(runner, rel, source) : discoverTests(rel, source);
                // Language runners match whole source folders (*.rs, *.cs); only files that declare tests are rows.
                if (!isLanguageRunner(runner) || tests.length) {
                    files.push({ path: rel, tests });
                }
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

    protected async manifest(root: string): Promise<ProjectManifest> {
        const [files, packageJson] = await Promise.all([
            fs.promises.readdir(root).catch(() => [] as string[]),
            fs.promises.readFile(path.join(root, 'package.json'), 'utf8').catch(() => '')
        ]);
        const present = RUNNER_MANIFESTS.filter(name => files.includes(name));
        const texts = await Promise.all(present.map(name => fs.promises.readFile(path.join(root, name), 'utf8').catch(() => '')));
        return { files, packageJson, manifests: Object.fromEntries(present.map((name, i) => [name, texts[i]])) };
    }

    protected async detect(root: string): Promise<{ runner?: TestRunner; reason?: string }> {
        const manifest = await this.manifest(root);
        const js = detectRunner(manifest);
        return js.runner ? js : detectLanguageRunner(manifest);
    }

    protected async runNow(root: string, request: TestRunRequest): Promise<TestRunResult> {
        const { runner } = await this.detect(root);
        if (!runner) {
            return runError(undefined, NO_RUNNER_TEXT);
        }
        if (isLanguageRunner(runner)) {
            return this.runLanguage(root, runner, request);
        }
        return this.runJs(root, runner as JsTestRunner, request);
    }

    protected async runJs(root: string, runner: JsTestRunner, request: TestRunRequest): Promise<TestRunResult> {
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

    /** IDEA-313: a missing toolchain is reported with how to install it; otherwise the runner's report is matched to the discovered tests. */
    protected async runLanguage(root: string, runner: LanguageTestRunner, request: TestRunRequest): Promise<TestRunResult> {
        const { result, output } = await this.runLanguageNow(root, runner, request);
        const hint = result.status === 'error' ? runnerHint(runner, `${output}\n${result.error ?? ''}`) : undefined;
        return hint ? { ...result, error: `${hint}\n\n${result.error ?? ''}`.trim() } : result;
    }

    protected async runLanguageNow(root: string, runner: LanguageTestRunner, request: TestRunRequest): Promise<{ result: TestRunResult; output: string }> {
        const spec = languageRunnerSpec(runner);
        const statuses = await this.toolchains?.check(spec.toolchains) ?? [];
        const missing = statuses.find(status => !isUsable(status));
        if (missing) {
            const language = languageById(spec.language)?.label ?? spec.language;
            return { result: runError(runner, missingToolchainMessage(language, missing.id, missing, guidePlatform(process.platform))), output: '' };
        }
        const context = await this.toolchains?.runContext();
        const jdk = statuses.find(status => status.id === 'jdk');
        const env: Record<string, string> = {
            ...(context ? { PATH: context.path } : {}),
            ...(jdk?.bundled && jdk.path ? { JAVA_HOME: jdk.path } : {})
        };
        const dir = await fs.promises.mkdtemp(path.join(os.tmpdir(), 'ingot-tests-'));
        try {
            const manifest = await this.manifest(root);
            const command = languageRunnerCommand(runner, request, { files: manifest.files, manifests: manifest.manifests, reportDir: dir, windows: IS_WINDOWS });
            const shown = commandLine(command);
            const started = Date.now();
            for (const step of command.before ?? []) {
                const result = await this.spawn(root, this.languageBin(root, step.bin), { ...step, env: { ...step.env, ...env } }, LANGUAGE_OUTPUT_BUFFER_CHARS);
                if (result.error || result.code !== 0) {
                    const tail = result.output.trim().slice(-RUN_OUTPUT_TAIL_CHARS);
                    return { result: runError(runner, `${commandLine(step)} ${result.error ?? `exited with code ${result.code ?? '?'}`}.${tail ? `\n${tail}` : ''}`, shown), output: result.output };
                }
            }
            const { code, output, error } = await this.spawn(root, this.languageBin(root, command.bin), { ...command, env: { ...command.env, ...env } }, LANGUAGE_OUTPUT_BUFFER_CHARS);
            const durationMs = Date.now() - started;
            const tail = output.trim().slice(-RUN_OUTPUT_TAIL_CHARS);
            if (error) {
                return { result: runError(runner, `${shown}: ${error}`, shown), output };
            }
            const reports = await this.readReports(root, spec.format === 'junit-dir' ? path.join(root, spec.reportDir ?? '') : dir, command.reportFile, started);
            const cases = parseLanguageReport(runner, { reports, output });
            if (!cases) {
                return { result: runError(runner, `${shown} exited with code ${code ?? '?'} without a report.${tail ? `\n${tail}` : ''}`, shown), output };
            }
            const discovered = await this.discover(root);
            const tests = filterToRequest(matchToDiscovered(cases, discovered.files, root), request);
            return { result: summarizeRun(runner, tests, durationMs, code, shown, tail), output };
        } finally {
            await fs.promises.rm(dir, { recursive: true, force: true }).catch(() => undefined);
        }
    }

    /** The report file, else every report the runner wrote in `dir` during this run (Maven, Gradle, dotnet). */
    protected async readReports(root: string, dir: string, reportFile: string | undefined, since: number): Promise<string[]> {
        if (reportFile) {
            const text = await fs.promises.readFile(reportFile, 'utf8').catch(() => undefined);
            return text === undefined ? [] : [text];
        }
        const names = await fs.promises.readdir(dir).catch(() => [] as string[]);
        const texts: string[] = [];
        for (const name of names.filter(n => /\.(?:xml|trx)$/i.test(n))) {
            const file = path.join(dir, name);
            const stat = await fs.promises.stat(file).catch(() => undefined);
            if (stat && stat.mtimeMs >= since - TIMESTAMP_SLACK_MS) {
                texts.push(await fs.promises.readFile(file, 'utf8').catch(() => ''));
            }
        }
        return texts;
    }

    /** A project-relative runner (`./mvnw`, `vendor/bin/phpunit`) from the project, else the command on PATH. */
    protected languageBin(root: string, bin: string): Bin {
        const local = bin.startsWith('.') || bin.includes('/') || bin.includes('\\');
        return { cmd: local ? path.resolve(root, bin) : bin, prefix: [] };
    }

    /** The runner from the nearest node_modules/.bin (monorepos hoist it), else npx. */
    protected findBin(root: string, bin: string): Bin {
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

    protected spawn(cwd: string, bin: Bin, command: RunnerCommand, bufferChars = RUN_OUTPUT_BUFFER_CHARS): Promise<SpawnResult> {
        return new Promise(resolve => {
            let output = '';
            const child = spawn(bin.cmd, [...bin.prefix, ...command.args], {
                cwd, shell: IS_WINDOWS, stdio: ['ignore', 'pipe', 'pipe'],
                env: { ...process.env, ...command.env, CI: '1', FORCE_COLOR: '0', NO_COLOR: '1' }
            });
            const add = (chunk: Buffer): void => {
                output = `${output}${chunk.toString('utf8')}`.slice(-bufferChars);
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
