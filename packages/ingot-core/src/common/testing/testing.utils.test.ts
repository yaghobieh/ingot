import { describe, expect, it } from 'vitest';
import {
    clampIterations, detectRunner, discoverTests, explorerFiles, failedRequest, formatForAgent, isTestFile, parseReport, requestFromArgs,
    runnerCommand, summarizeRun, testId, testLoopStep, titlePattern
} from './testing.utils';
import { DEFAULT_TEST_ITERATIONS, MAX_TEST_ITERATIONS_CAP, TESTS_CAPPED_TEXT, TESTS_GREEN_TEXT, TESTS_RED_TEXT } from './testing.consts';
import type { TestResult } from './testing.types';

const ROOT = '/work/app';
const pkg = (json: object): string => JSON.stringify(json);

describe('test runner detection (IDEA-261)', () => {
    it('prefers the runner the test script calls, then config files, then dependencies', () => {
        expect(detectRunner({ files: ['vitest.config.ts'], packageJson: pkg({ scripts: { test: 'jest --ci' } }) })).toEqual({ runner: 'jest', reason: 'scripts.test' });
        expect(detectRunner({ files: ['package.json', 'playwright.config.ts'], packageJson: pkg({}) })).toEqual({ runner: 'playwright', reason: 'playwright.config.ts' });
        expect(detectRunner({ files: ['.mocharc.json'], packageJson: pkg({}) }).runner).toBe('mocha');
        expect(detectRunner({ files: [], packageJson: pkg({ jest: { testEnvironment: 'node' } }) }).runner).toBe('jest');
        expect(detectRunner({ files: [], packageJson: pkg({ devDependencies: { '@playwright/test': '1', vitest: '2' } }) }).runner).toBe('vitest');
        expect(detectRunner({ files: [], packageJson: pkg({ scripts: { test: 'playwright test' } }) }).runner).toBe('playwright');
    });

    it('finds no runner in a project without one or with broken package.json', () => {
        expect(detectRunner({ files: ['README.md'], packageJson: '{ nope' })).toEqual({});
        expect(detectRunner({ files: [], packageJson: pkg({ scripts: { test: 'node --test' } }) })).toEqual({});
    });

    it('treats .test/.spec files as tests, and test/ folders only for mocha', () => {
        expect(isTestFile('src/sum.test.ts', 'vitest')).toBe(true);
        expect(isTestFile('e2e/home.spec.js', 'playwright')).toBe(true);
        expect(isTestFile('test/sum.js', 'mocha')).toBe(true);
        expect(isTestFile('test/sum.js', 'jest')).toBe(false);
        expect(isTestFile('src/sum.ts', 'vitest')).toBe(false);
    });
});

describe('test discovery from source (IDEA-261)', () => {
    it('reads nested suites, modifiers and Playwright test.describe with lines', () => {
        const source = [
            "import { describe, it } from 'vitest';",
            "describe('math', () => {",
            "    it('adds', () => { expect('{').toBe('{'); });",
            "    describe(\"sub\", () => {",
            "        it.skip('subtracts', () => {});",
            '    });',
            "    test(`multiplies`, () => {});",
            '});',
            "test.describe('page', () => {",
            "    test('loads', async () => { /re/.test('x'); });",
            '});',
            "it('top level', () => {});"
        ].join('\n');
        const tests = discoverTests('src/math.test.ts', source);
        expect(tests.map(test => [test.suites.join('/'), test.title, test.line])).toEqual([
            ['math', 'adds', 3],
            ['math/sub', 'subtracts', 5],
            ['math', 'multiplies', 7],
            ['page', 'loads', 10],
            ['', 'top level', 12]
        ]);
        expect(tests[0].id).toBe('src/math.test.ts::math adds');
    });

    it('ignores test calls inside comments and method calls named test', () => {
        const source = "// it('commented', () => {})\nconst ok = /a/.test('a');\n/* describe('block', () => {}) */\nit('real', () => {});\n";
        expect(discoverTests('a.test.js', source).map(test => test.title)).toEqual(['real']);
    });
});

describe('runner commands (IDEA-261)', () => {
    it('writes a JSON report and filters by file and title for each runner', () => {
        const request = { files: ['src/a.test.ts'], titles: ['adds (1+1)', 'adds (1+1)', 'b'] };
        expect(titlePattern(request.titles)).toBe('adds \\(1\\+1\\)|b');
        expect(runnerCommand('vitest', request, '/tmp/r.json').args).toEqual(['run', '--reporter=json', '--outputFile=/tmp/r.json', 'src/a.test.ts', '-t', 'adds \\(1\\+1\\)|b']);
        expect(runnerCommand('jest', { files: ['a.test.js'] }, '/tmp/r.json').args).toEqual(['--ci', '--json', '--outputFile=/tmp/r.json', '--testLocationInResults', '--runTestsByPath', 'a.test.js']);
        expect(runnerCommand('mocha', { titles: ['x'] }, '/tmp/r.json').args).toEqual(['--reporter', 'json', '--reporter-option', 'output=/tmp/r.json', '--grep', 'x']);
        const pw = runnerCommand('playwright', {}, '/tmp/r.json');
        expect(pw.args).toEqual(['test', '--reporter=json']);
        expect(pw.env).toEqual({ PLAYWRIGHT_JSON_OUTPUT_NAME: '/tmp/r.json' });
    });
});

describe('runner reports (IDEA-261)', () => {
    it('parses a vitest / jest report, including a file that failed to load', () => {
        const report = {
            testResults: [
                {
                    name: `${ROOT}/src/sum.test.js`, status: 'failed', assertionResults: [
                        { ancestorTitles: ['sum'], title: 'adds', status: 'passed', duration: 2, failureMessages: [] },
                        { ancestorTitles: ['sum'], title: 'carries', status: 'failed', duration: 3, failureMessages: [`\u001b[31mAssertionError: expected 1 to be 2\u001b[39m\n    at ${ROOT}/src/sum.test.js:9:18`] },
                        { ancestorTitles: [], title: 'later', status: 'pending', failureMessages: [] }
                    ]
                },
                { name: `${ROOT}/src/broken.test.js`, status: 'failed', message: 'SyntaxError: Unexpected token (3:4)', assertionResults: [] }
            ]
        };
        const tests = parseReport('vitest', report, ROOT)!;
        expect(tests.map(test => [test.id, test.state])).toEqual([
            ['src/sum.test.js::sum adds', 'passed'],
            ['src/sum.test.js::sum carries', 'failed'],
            ['src/sum.test.js::later', 'skipped'],
            ['src/broken.test.js::', 'failed']
        ]);
        expect(tests[1]).toMatchObject({ line: 9, message: expect.stringMatching(/^AssertionError: expected 1 to be 2/) });
        expect(tests[1].message).not.toContain('\u001b');
        expect(parseReport('jest', { nope: true }, ROOT)).toBeUndefined();
    });

    it('parses a mocha report', () => {
        const pass = { title: 'adds', fullTitle: 'sum adds', file: `${ROOT}/test/sum.js`, duration: 1, err: {} };
        const fail = { title: 'carries', fullTitle: 'sum carries', file: `${ROOT}/test/sum.js`, duration: 1, err: { message: 'expected 1 to equal 2', stack: `AssertionError\n at Context (${ROOT}/test/sum.js:7:12)` } };
        const skip = { title: 'later', fullTitle: 'sum later', file: `${ROOT}/test/sum.js`, err: {} };
        const tests = parseReport('mocha', { tests: [pass, fail, skip], failures: [fail], pending: [skip] }, ROOT)!;
        expect(tests.map(test => [test.id, test.state, test.line])).toEqual([
            ['test/sum.js::sum adds', 'passed', undefined],
            ['test/sum.js::sum carries', 'failed', 7],
            ['test/sum.js::sum later', 'skipped', undefined]
        ]);
    });

    it('parses a playwright report with nested describes and top-level errors', () => {
        const report = {
            config: { rootDir: `${ROOT}/e2e` },
            suites: [{
                title: 'home.spec.ts', file: 'home.spec.ts', specs: [
                    { title: 'loads', file: 'home.spec.ts', line: 3, tests: [{ projectName: '', status: 'expected', results: [{ status: 'passed', duration: 40 }] }] }
                ],
                suites: [{
                    title: 'cart', file: 'home.spec.ts', specs: [
                        { title: 'adds item', file: 'home.spec.ts', line: 8, tests: [{ projectName: 'chromium', status: 'unexpected', results: [{ status: 'failed', duration: 10, error: { message: 'Timed out' } }] }] }
                    ]
                }]
            }],
            errors: [{ message: 'Error: cannot find module', location: { file: `${ROOT}/e2e/broken.spec.ts`, line: 1 } }]
        };
        const tests = parseReport('playwright', report, ROOT)!;
        expect(tests.map(test => [test.id, test.state, test.line])).toEqual([
            ['e2e/home.spec.ts::loads', 'passed', 3],
            ['e2e/home.spec.ts::cart adds item', 'failed', 8],
            ['e2e/broken.spec.ts::', 'failed', 1]
        ]);
        expect(tests[1].name).toBe('[chromium] › cart › adds item');
    });
});

const result = (id: string, state: TestResult['state'], patch: Partial<TestResult> = {}): TestResult => {
    const [file, name] = id.split('::');
    return { id, file, name: name.split(' ').join(' › '), state, ...patch };
};

describe('run summary and the explorer tree (IDEA-261)', () => {
    it('reports failed, passed and runner errors', () => {
        const tests = [result('a.test.js::sum adds', 'passed'), result('a.test.js::sum carries', 'failed', { message: 'boom' })];
        expect(summarizeRun('vitest', tests, 50, 1, 'vitest run', '')).toMatchObject({ status: 'failed', passed: 1, failed: 1, skipped: 0 });
        expect(summarizeRun('vitest', tests.slice(0, 1), 50, 0, 'vitest run', '').status).toBe('passed');
        expect(summarizeRun('vitest', [], 50, 1, 'vitest run', 'No test files found').error).toContain('No test files found');
        expect(summarizeRun('jest', tests.slice(0, 1), 50, 1, 'jest', '').status).toBe('error');
    });

    it('builds a rerun-failed request from the failed tests only', () => {
        const tests = [result('a.test.js::sum adds', 'passed'), result('a.test.js::sum carries', 'failed'), result('b.test.js::x', 'failed')];
        expect(failedRequest(tests)).toEqual({ files: ['a.test.js', 'b.test.js'], titles: ['carries', 'x'] });
        expect(failedRequest(tests.slice(0, 1))).toBeUndefined();
    });

    it('merges discovered tests with results and rolls the state up to the file', () => {
        const discovered = [{ path: 'a.test.js', tests: discoverTests('a.test.js', "describe('sum', () => { it('adds', () => {}); it('carries', () => {}); });") }];
        const results = new Map([
            [testId('a.test.js', ['sum'], 'adds'), result('a.test.js::sum adds', 'passed')],
            [testId('a.test.js', ['sum'], 'carries'), result('a.test.js::sum carries', 'failed', { message: 'boom' })],
            ['c.test.js::each 1', result('c.test.js::each 1', 'passed')]
        ]);
        const files = explorerFiles(discovered, results);
        expect(files.map(file => [file.path, file.state, file.tests.map(test => test.state)])).toEqual([
            ['a.test.js', 'failed', ['passed', 'failed']],
            ['c.test.js', 'passed', ['passed']]
        ]);
        expect(explorerFiles(discovered, new Map())[0].state).toBeUndefined();
    });
});

describe('agent test loop (IDEA-261)', () => {
    it('counts iterations and caps a red run at the limit', () => {
        expect(testLoopStep(0, 3, 'failed')).toEqual({ iteration: 1, max: 3, capped: false });
        expect(testLoopStep(2, 3, 'failed')).toEqual({ iteration: 3, max: 3, capped: true });
        expect(testLoopStep(2, 3, 'passed').capped).toBe(false);
        expect(clampIterations(0)).toBe(1);
        expect(clampIterations(99)).toBe(MAX_TEST_ITERATIONS_CAP);
        expect(clampIterations('x')).toBe(DEFAULT_TEST_ITERATIONS);
    });

    it('returns structured pass/fail with failures and the next step', () => {
        const red = summarizeRun('vitest', [result('a.test.js::sum carries', 'failed', { line: 4, message: 'expected 1 to be 2\nstack' })], 812, 1, 'vitest run', '');
        const text = formatForAgent(red, { iteration: 1, max: 5, capped: false });
        expect(text.split('\n')[0]).toBe('Tests FAILED: 1 failed, 0 passed, 0 skipped (vitest, 0.8s). Iteration 1 of 5.');
        expect(text).toContain('- a.test.js:4 › sum › carries: expected 1 to be 2');
        const json = JSON.parse(text.split('\n').find(line => line.startsWith('{'))!);
        expect(json).toMatchObject({ status: 'failed', failed: 1, iteration: 1, maxIterations: 5, failures: [{ file: 'a.test.js', line: 4, name: 'sum › carries' }] });
        expect(text).toContain(TESTS_RED_TEXT);
        expect(formatForAgent(red, { iteration: 5, max: 5, capped: true })).toContain(TESTS_CAPPED_TEXT);
        const green = summarizeRun('vitest', [result('a.test.js::sum carries', 'passed')], 100, 0, 'vitest run', '');
        expect(formatForAgent(green, { iteration: 2, max: 5, capped: false })).toContain(TESTS_GREEN_TEXT);
    });

    it('reads run_tests arguments, refusing paths outside the project', () => {
        const last = [result('a.test.js::sum carries', 'failed')];
        expect(requestFromArgs({ failedOnly: true }, last)).toEqual({ files: ['a.test.js'], titles: ['carries'] });
        expect(requestFromArgs({ failedOnly: true }, [])).toEqual({});
        expect(requestFromArgs({ files: ['src/a.test.ts', '../x.test.ts', '/etc/passwd'], grep: 'adds' }, [])).toEqual({ files: ['src/a.test.ts'], titles: ['adds'] });
    });
});
