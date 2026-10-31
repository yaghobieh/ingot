/**
 * IDEA-261: pure parts of the Test Explorer and the agent's run_tests tool. Detects the runner, reads test names from
 * source, builds the runner command with a JSON reporter, and turns each runner's report into one result shape.
 */
import {
    AGENT_FAILURE_LIMIT, DEFAULT_TEST_ITERATIONS, FAILURE_MESSAGE_MAX_CHARS, ID_SEPARATOR, MAX_TEST_ITERATIONS_CAP, MOCHA_TEST_FILE,
    RUNNER_CONFIGS, RUNNER_PACKAGES, RUNNER_SCRIPT_WORDS, SUITE_CALLS, TEST_CALL, TEST_FILE, TEST_RUNNERS, TESTS_CAPPED_TEXT,
    TESTS_GREEN_TEXT, TESTS_RED_TEXT
} from './testing.consts';
import type {
    DiscoveredTest, ExplorerFile, ExplorerTest, JsTestRunner, ProjectManifest, RunnerCommand, TestLoopStep, TestResult, TestRunner, TestRunRequest,
    TestRunResult, TestState
} from './testing.types';
import { stripAnsi } from '../processes/processes.utils';

const MS_PER_SECOND = 1000;

export const testId = (file: string, suites: readonly string[], title: string): string => `${file}${ID_SEPARATOR}${[...suites, title].join(' ')}`;

const readPackage = (raw: string): { scripts: Record<string, unknown>; deps: Set<string>; jest: boolean } => {
    try {
        const json = JSON.parse(raw) as { scripts?: Record<string, unknown>; dependencies?: object; devDependencies?: object; jest?: unknown };
        return {
            scripts: json.scripts ?? {},
            deps: new Set([...Object.keys(json.dependencies ?? {}), ...Object.keys(json.devDependencies ?? {})]),
            jest: json.jest !== undefined
        };
    } catch {
        return { scripts: {}, deps: new Set(), jest: false };
    }
};

/** The runner the project uses: the one its `test` script calls, else a config file, else a dependency. */
export const detectRunner = (manifest: ProjectManifest): { runner?: TestRunner; reason?: string } => {
    const pkg = readPackage(manifest.packageJson);
    const script = typeof pkg.scripts.test === 'string' ? pkg.scripts.test : '';
    const byScript = TEST_RUNNERS.find(runner => RUNNER_SCRIPT_WORDS[runner].test(script));
    if (byScript) {
        return { runner: byScript, reason: 'scripts.test' };
    }
    for (const runner of TEST_RUNNERS) {
        const config = manifest.files.find(file => RUNNER_CONFIGS[runner].test(file));
        if (config) {
            return { runner, reason: config };
        }
    }
    if (pkg.jest) {
        return { runner: 'jest', reason: 'package.json "jest"' };
    }
    const byDep = TEST_RUNNERS.find(runner => pkg.deps.has(RUNNER_PACKAGES[runner]));
    return byDep ? { runner: byDep, reason: RUNNER_PACKAGES[byDep] } : {};
};

export const isTestFile = (path: string, runner: TestRunner | undefined): boolean =>
    TEST_FILE.test(path) || (runner === 'mocha' && MOCHA_TEST_FILE.test(path));

/** Brace depth before each character (strings, template literals and comments skipped) and which characters are comments. */
const scanSource = (source: string): { depths: Int32Array; comments: Uint8Array } => {
    const depths = new Int32Array(source.length + 1);
    const comments = new Uint8Array(source.length + 1);
    let depth = 0;
    let quote = '';
    for (let i = 0; i < source.length; i++) {
        depths[i] = depth;
        const ch = source[i];
        if (quote) {
            if (ch === '\\') {
                depths[++i] = depth;
            } else if (ch === quote) {
                quote = '';
            }
            continue;
        }
        if (ch === '/' && source[i + 1] === '/') {
            const end = source.indexOf('\n', i);
            const stop = end < 0 ? source.length : end;
            depths.fill(depth, i, stop);
            comments.fill(1, i, stop);
            i = stop - 1;
        } else if (ch === '/' && source[i + 1] === '*') {
            const end = source.indexOf('*/', i + 2);
            const stop = end < 0 ? source.length : end + 1;
            depths.fill(depth, i, stop + 1);
            comments.fill(1, i, stop + 1);
            i = stop;
        } else if (ch === '"' || ch === '\'' || ch === '`') {
            quote = ch;
        } else if (ch === '{') {
            depth++;
        } else if (ch === '}') {
            depth = Math.max(0, depth - 1);
        }
    }
    depths[source.length] = depth;
    return { depths, comments };
};

const lineAt = (source: string, index: number): number => source.slice(0, index).split('\n').length;

/**
 * Tests named in a file's source (`describe` / `it` / `test`, Playwright's `test.describe`), with their suites.
 * IDEA-313: brace languages with the same shape (Dart's `group` / `test`) pass their own call pattern.
 */
export const discoverTests = (file: string, source: string, call: RegExp = TEST_CALL, suiteCalls: ReadonlySet<string> = SUITE_CALLS): DiscoveredTest[] => {
    const { depths, comments } = scanSource(source);
    const suites: { title: string; depth: number; end: number }[] = [];
    const tests: DiscoveredTest[] = [];
    const seen = new Set<string>();
    for (const match of source.matchAll(call)) {
        const index = match.index ?? 0;
        if (comments[index]) {
            continue;
        }
        const depth = depths[index];
        while (suites.length && index >= suites[suites.length - 1].end) {
            suites.pop();
        }
        const title = match[3].replace(/\\(.)/g, '$1');
        if (suiteCalls.has(match[1])) {
            let end = index + match[0].length;
            while (end < source.length && depths[end] <= depth) {
                end++;
            }
            while (end < source.length && depths[end] > depth) {
                end++;
            }
            suites.push({ title, depth, end });
            continue;
        }
        const names = suites.map(suite => suite.title);
        const id = testId(file, names, title);
        if (!seen.has(id)) {
            seen.add(id);
            tests.push({ id, file, suites: names, title, line: lineAt(source, index) });
        }
    }
    return tests;
};

export const escapeRegex = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');

/** One name filter for every runner: an alternation of the titles, matched anywhere in the full name. */
export const titlePattern = (titles: readonly string[]): string | undefined => {
    const unique = [...new Set(titles.map(title => title.trim()).filter(Boolean))];
    return unique.length ? unique.map(escapeRegex).join('|') : undefined;
};

/** The runner binary, its arguments (JSON report to `outputFile`) and extra environment. */
export const runnerCommand = (runner: JsTestRunner, request: TestRunRequest, outputFile: string): RunnerCommand => {
    const files = [...(request.files ?? [])];
    const pattern = titlePattern(request.titles ?? []);
    switch (runner) {
        case 'vitest':
            return { bin: 'vitest', args: ['run', '--reporter=json', `--outputFile=${outputFile}`, ...files, ...(pattern ? ['-t', pattern] : [])], env: {} };
        case 'jest':
            return {
                bin: 'jest',
                args: ['--ci', '--json', `--outputFile=${outputFile}`, '--testLocationInResults', ...(files.length ? ['--runTestsByPath', ...files] : []), ...(pattern ? ['-t', pattern] : [])],
                env: {}
            };
        case 'mocha':
            return { bin: 'mocha', args: ['--reporter', 'json', '--reporter-option', `output=${outputFile}`, ...files, ...(pattern ? ['--grep', pattern] : [])], env: {} };
        case 'playwright':
            return { bin: 'playwright', args: ['test', '--reporter=json', ...files, ...(pattern ? ['-g', pattern] : [])], env: { PLAYWRIGHT_JSON_OUTPUT_NAME: outputFile } };
    }
};

export const commandLine = (command: RunnerCommand): string =>
    [command.bin, ...command.args.map(arg => /[\s|"'$]/.test(arg) ? JSON.stringify(arg) : arg)].join(' ');

const slash = (path: string): string => path.replace(/\\/g, '/');

/** A runner path (absolute or relative) as a project-relative path. */
export const relativeTo = (root: string, path: string): string => {
    const base = slash(root).replace(/\/+$/, '');
    const full = slash(path);
    return full.startsWith(`${base}/`) ? full.slice(base.length + 1) : full.replace(/^\.\//, '');
};

const clean = (text: string): string => stripAnsi(text).trim().slice(0, FAILURE_MESSAGE_MAX_CHARS);

const STACK_FRAME = /^\s*at\s/;

/** The error lines and the first stack frame in the test file; runner internals are dropped. */
export const compactFailure = (message: string, file: string): string => {
    const base = file.split('/').pop() ?? file;
    const lines = stripAnsi(message).split('\n');
    const frame = lines.find(line => STACK_FRAME.test(line) && line.includes(base));
    const kept = lines.filter(line => !STACK_FRAME.test(line) && line.trim());
    return clean([...kept, ...(frame ? [frame.trim()] : [])].join('\n'));
};

/** The first `<file>:<line>` in a stack that points into the test file. */
export const lineFromStack = (message: string, file: string): number | undefined => {
    const base = file.split('/').pop();
    if (!base) {
        return undefined;
    }
    const match = new RegExp(`${escapeRegex(base)}:(\\d+)(?::\\d+)?`).exec(message);
    return match ? Number(match[1]) : undefined;
};

/** The JSON object in a runner's stdout when it did not write the report file. */
export const extractJson = (text: string): unknown => {
    const start = text.indexOf('{');
    const end = text.lastIndexOf('}');
    if (start < 0 || end <= start) {
        return undefined;
    }
    try {
        return JSON.parse(text.slice(start, end + 1));
    } catch {
        return undefined;
    }
};

const record = (value: unknown): Record<string, unknown> => value && typeof value === 'object' && !Array.isArray(value) ? value as Record<string, unknown> : {};
const array = (value: unknown): unknown[] => Array.isArray(value) ? value : [];
const text = (value: unknown): string => typeof value === 'string' ? value : '';
const num = (value: unknown): number | undefined => typeof value === 'number' && Number.isFinite(value) ? value : undefined;

const jestState = (status: string): TestState => status === 'passed' ? 'passed' : status === 'failed' ? 'failed' : 'skipped';

/** Vitest and Jest share the Jest JSON report (`testResults[].assertionResults[]`). */
const parseJestReport = (report: Record<string, unknown>, root: string): TestResult[] => {
    const results: TestResult[] = [];
    for (const suite of array(report.testResults).map(record)) {
        const file = relativeTo(root, text(suite.name));
        const assertions = array(suite.assertionResults).map(record);
        for (const assertion of assertions) {
            const suites = array(assertion.ancestorTitles).map(text);
            const title = text(assertion.title);
            const message = compactFailure(array(assertion.failureMessages).map(text).join('\n'), file);
            const state = jestState(text(assertion.status));
            results.push({
                id: testId(file, suites, title), file, name: [...suites, title].join(' › '), state,
                line: num(record(assertion.location).line) ?? (message ? lineFromStack(message, file) : undefined),
                durationMs: num(assertion.duration),
                ...(state === 'failed' && message ? { message } : {})
            });
        }
        const suiteMessage = clean(text(suite.message) || text(suite.failureMessage));
        if (!assertions.length && text(suite.status) === 'failed' && suiteMessage) {
            results.push({ id: testId(file, [], ''), file, name: 'File failed to run', state: 'failed', message: suiteMessage, line: lineFromStack(suiteMessage, file) });
        }
    }
    return results;
};

const parseMochaReport = (report: Record<string, unknown>, root: string): TestResult[] => {
    const failed = new Set(array(report.failures).map(record).map(test => `${text(test.file)}\n${text(test.fullTitle)}`));
    const pending = new Set(array(report.pending).map(record).map(test => `${text(test.file)}\n${text(test.fullTitle)}`));
    return array(report.tests).map(record).map(test => {
        const file = relativeTo(root, text(test.file));
        const key = `${text(test.file)}\n${text(test.fullTitle)}`;
        const err = record(test.err);
        const message = compactFailure(text(err.stack) || text(err.message), file);
        const state: TestState = failed.has(key) || message ? 'failed' : pending.has(key) ? 'skipped' : 'passed';
        const full = text(test.fullTitle);
        return {
            id: `${file}${ID_SEPARATOR}${full}`, file, name: full, state, durationMs: num(test.duration),
            ...(state === 'failed' ? { message, line: lineFromStack(message, file) } : {})
        };
    });
};

const playwrightState = (test: Record<string, unknown>): TestState => {
    const status = text(test.status);
    return status === 'unexpected' ? 'failed' : status === 'skipped' ? 'skipped' : 'passed';
};

const parsePlaywrightReport = (report: Record<string, unknown>, root: string): TestResult[] => {
    const rootDir = slash(text(record(report.config).rootDir));
    const results: TestResult[] = [];
    const walk = (suite: Record<string, unknown>, titles: readonly string[], top: boolean): void => {
        const here = top ? titles : [...titles, text(suite.title)];
        for (const spec of array(suite.specs).map(record)) {
            const specFile = text(spec.file);
            const file = relativeTo(root, rootDir && specFile && !specFile.startsWith('/') ? `${rootDir}/${specFile}` : specFile);
            for (const test of array(spec.tests).map(record)) {
                const runs = array(test.results).map(record);
                const last = runs[runs.length - 1] ?? {};
                const state = playwrightState(test);
                const message = clean(text(record(last.error).message) || array(last.errors).map(record).map(error => text(error.message)).join('\n'));
                const title = text(spec.title);
                const project = text(test.projectName);
                results.push({
                    id: testId(file, here, title), file, name: [...(project ? [`[${project}]`] : []), ...here, title].join(' › '), state,
                    line: num(spec.line), durationMs: runs.reduce((sum, run) => sum + (num(run.duration) ?? 0), 0),
                    ...(state === 'failed' && message ? { message } : {})
                });
            }
        }
        for (const child of array(suite.suites).map(record)) {
            walk(child, here, false);
        }
    };
    for (const suite of array(report.suites).map(record)) {
        walk(suite, [], true);
    }
    for (const error of array(report.errors).map(record)) {
        const message = clean(text(error.message));
        const where = record(error.location);
        const file = relativeTo(root, text(where.file));
        if (message) {
            results.push({ id: testId(file, [], ''), file, name: 'Run error', state: 'failed', message, line: num(where.line) });
        }
    }
    return results;
};

/** A title-filtered run reports the other tests of its files as skipped; those are not results. */
export const scopeToRequest = (tests: readonly TestResult[], request: TestRunRequest): TestResult[] => {
    const titles = new Set((request.titles ?? []).map(title => title.trim()));
    if (!titles.size) {
        return [...tests];
    }
    return tests.filter(test => test.state !== 'skipped' || titles.has(test.name.split(' › ').pop() ?? ''));
};

/** Results from a runner's JSON report, or undefined when the report is not one. */
export const parseReport = (runner: JsTestRunner, raw: unknown, root: string): TestResult[] | undefined => {
    const report = record(raw);
    if (runner === 'vitest' || runner === 'jest') {
        return Array.isArray(report.testResults) ? parseJestReport(report, root) : undefined;
    }
    if (runner === 'mocha') {
        return Array.isArray(report.tests) ? parseMochaReport(report, root) : undefined;
    }
    return Array.isArray(report.suites) ? parsePlaywrightReport(report, root) : undefined;
};

export const summarizeRun = (runner: TestRunner, tests: readonly TestResult[], durationMs: number, exitCode: number | undefined, command: string, outputTail: string): TestRunResult => {
    const count = (state: TestState): number => tests.filter(test => test.state === state).length;
    const failed = count('failed');
    const base = { runner, passed: count('passed'), failed, skipped: count('skipped'), durationMs, tests, command };
    if (failed) {
        return { ...base, status: 'failed' };
    }
    if (!tests.length) {
        return { ...base, status: 'error', error: `No tests ran.${outputTail ? `\n${outputTail}` : ''}` };
    }
    if (exitCode !== undefined && exitCode !== 0) {
        return { ...base, status: 'error', error: `The runner exited with code ${exitCode} although no test failed.${outputTail ? `\n${outputTail}` : ''}` };
    }
    return { ...base, status: 'passed' };
};

export const runError = (runner: TestRunner | undefined, error: string, command?: string): TestRunResult =>
    ({ runner, status: 'error', passed: 0, failed: 0, skipped: 0, durationMs: 0, tests: [], error, ...(command ? { command } : {}) });

/** The request that reruns only the failed tests of a run (their files, filtered by title). */
export const failedRequest = (tests: readonly TestResult[]): TestRunRequest | undefined => {
    const failed = tests.filter(test => test.state === 'failed');
    if (!failed.length) {
        return undefined;
    }
    const titles = failed.map(test => test.name.split(' › ').pop() ?? '').filter(Boolean);
    return { files: [...new Set(failed.map(test => test.file).filter(Boolean))], ...(titles.length ? { titles } : {}) };
};

const aggregate = (states: readonly (TestState | undefined)[]): TestState | undefined => {
    if (states.includes('failed')) {
        return 'failed';
    }
    if (states.includes('passed')) {
        return 'passed';
    }
    return states.length && states.every(state => state === 'skipped') ? 'skipped' : undefined;
};

/** Explorer rows: every discovered test with its latest result, plus results the source scan did not see. */
export const explorerFiles = (files: readonly { path: string; tests: readonly DiscoveredTest[] }[], results: ReadonlyMap<string, TestResult>): ExplorerFile[] => {
    const byFile = new Map<string, ExplorerTest[]>();
    const known = new Set<string>();
    for (const file of files) {
        byFile.set(file.path, file.tests.map(test => {
            known.add(test.id);
            const result = results.get(test.id);
            return { id: test.id, title: test.title, suites: test.suites, line: result?.line ?? test.line, state: result?.state, message: result?.message, durationMs: result?.durationMs };
        }));
    }
    for (const result of results.values()) {
        if (known.has(result.id) || !result.file) {
            continue;
        }
        const parts = result.name.split(' › ');
        const row: ExplorerTest = { id: result.id, title: parts.pop() ?? result.name, suites: parts, line: result.line, state: result.state, message: result.message, durationMs: result.durationMs };
        byFile.set(result.file, [...(byFile.get(result.file) ?? []), row]);
    }
    return [...byFile.entries()]
        .sort(([a], [b]) => a.localeCompare(b))
        .map(([path, tests]) => ({ path, tests, state: aggregate(tests.map(test => test.state)) }));
};

/** The test loop after a run: the iteration it used and whether the cap stops the agent. */
export const testLoopStep = (previous: number, max: number, status: TestRunResult['status']): TestLoopStep => {
    const iteration = previous + 1;
    return { iteration, max, capped: status !== 'passed' && iteration >= max };
};

export const clampIterations = (raw: unknown): number =>
    typeof raw === 'number' && Number.isFinite(raw) ? Math.min(MAX_TEST_ITERATIONS_CAP, Math.max(1, Math.floor(raw))) : DEFAULT_TEST_ITERATIONS;

const seconds = (ms: number): string => `${(ms / MS_PER_SECOND).toFixed(1)}s`;

/** The run_tests tool result: a readable line, the failures, one JSON line with the same data, and what to do next. */
export const formatForAgent = (result: TestRunResult, step: TestLoopStep): string => {
    const failures = result.tests.filter(test => test.state === 'failed').slice(0, AGENT_FAILURE_LIMIT);
    const head = result.status === 'error'
        ? `Tests could not run${result.runner ? ` (${result.runner})` : ''}.`
        : `Tests ${result.status === 'passed' ? 'passed' : 'FAILED'}: ${result.failed} failed, ${result.passed} passed, ${result.skipped} skipped (${result.runner ?? 'unknown'}, ${seconds(result.durationMs)}).`;
    const json = {
        runner: result.runner, status: result.status, passed: result.passed, failed: result.failed, skipped: result.skipped,
        iteration: step.iteration, maxIterations: step.max,
        failures: failures.map(test => ({ file: test.file, line: test.line, name: test.name, message: test.message ?? '' }))
    };
    return [
        `${head} Iteration ${step.iteration} of ${step.max}.`,
        result.error ? result.error : '',
        failures.length ? ['Failures:', ...failures.map(test => `- ${test.file}${test.line ? `:${test.line}` : ''} › ${test.name}: ${(test.message ?? '').split('\n')[0]}`)].join('\n') : '',
        JSON.stringify(json),
        result.status === 'passed' ? TESTS_GREEN_TEXT : step.capped ? TESTS_CAPPED_TEXT : TESTS_RED_TEXT
    ].filter(Boolean).join('\n');
};

/** Arguments of a run_tests call as a request; `failedOnly` reuses the last run's failures. */
export const requestFromArgs = (args: Record<string, unknown>, lastTests: readonly TestResult[]): TestRunRequest => {
    if (args.failedOnly === true) {
        const failed = failedRequest(lastTests);
        if (failed) {
            return failed;
        }
    }
    const list = (value: unknown): string[] => Array.isArray(value) ? value.filter((item): item is string => typeof item === 'string' && item.trim().length > 0)
        : typeof value === 'string' && value.trim() ? [value] : [];
    const files = list(args.files).filter(file => !file.startsWith('/') && !file.split(/[\\/]/).includes('..'));
    const titles = list(args.grep);
    return { ...(files.length ? { files } : {}), ...(titles.length ? { titles } : {}) };
};
