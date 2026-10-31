import type { JsTestRunner } from './testing.types';

/** IDEA-261: test runner detection, discovery limits and the agent test loop. */
export const TEST_SERVICE_PATH = '/services/ingot-tests';

export const TEST_EXPLORER_WIDGET_ID = 'ingot-test-explorer';

/** Command ids shared by the Test Explorer and the keymap. */
export const TEST_COMMAND_IDS = {
    toggle: 'ingot.tests.toggle',
    refresh: 'ingot.tests.refresh',
    runAll: 'ingot.tests.runAll',
    rerunFailed: 'ingot.tests.rerunFailed'
} as const;

/** Detection order when several runners are present and the test script names none. */
export const TEST_RUNNERS: readonly JsTestRunner[] = ['vitest', 'jest', 'mocha', 'playwright'];

export const RUNNER_PACKAGES: Readonly<Record<JsTestRunner, string>> = {
    vitest: 'vitest',
    jest: 'jest',
    mocha: 'mocha',
    playwright: '@playwright/test'
};

export const RUNNER_CONFIGS: Readonly<Record<JsTestRunner, RegExp>> = {
    vitest: /^vitest\.config\.[cm]?[jt]s$/,
    jest: /^jest\.config\.[cm]?[jt]s$|^jest\.config\.json$/,
    mocha: /^\.mocharc(\.[cm]?js|\.json|\.ya?ml)?$/,
    playwright: /^playwright\.config\.[cm]?[jt]s$/
};

/** The word the `test` script uses for each runner (`playwright test`, `vitest run`). */
export const RUNNER_SCRIPT_WORDS: Readonly<Record<JsTestRunner, RegExp>> = {
    vitest: /\bvitest\b/,
    jest: /\bjest\b/,
    mocha: /\bmocha\b/,
    playwright: /\bplaywright\s+test\b/
};

export const TEST_FILE = /\.(?:test|spec)\.[cm]?[jt]sx?$/i;
/** Mocha's default folder holds tests without a .test/.spec suffix. */
export const MOCHA_TEST_FILE = /(?:^|\/)tests?\/.+\.[cm]?[jt]s$/i;
export const DISCOVERY_SKIPPED_DIRS: ReadonlySet<string> = new Set([
    'node_modules', '.git', 'dist', 'lib', 'build', 'out', 'coverage', '.next', '.turbo', '.cache', 'test-results', 'playwright-report',
    // IDEA-313: build output and dependencies of the other languages.
    'target', 'bin', 'obj', 'vendor', 'venv', '__pycache__', 'Pods', 'DerivedData'
]);
export const MAX_TEST_FILES = 400;
export const MAX_TEST_FILE_BYTES = 512 * 1024;
export const MAX_DISCOVERY_DEPTH = 8;

/** `describe('x'`, `test.describe('x'`, `it.only("x"`, `test.skip(\`x\``. */
export const TEST_CALL = /(?<![\w$.])(?:test\.)?(describe|suite|context|it|test|specify)(?:\.(?:only|skip|todo|fixme|concurrent|serial|parallel))?\s*\(\s*(['"`])((?:\\.|(?!\2)[^\\\n])*)\2/g;
export const SUITE_CALLS: ReadonlySet<string> = new Set(['describe', 'suite', 'context']);
export const ID_SEPARATOR = '::';

export const TEST_RUN_TIMEOUT_MS = 300_000;
export const RUN_OUTPUT_TAIL_CHARS = 4_000;
/** Runner output kept in memory while it runs (the report file carries the results). */
export const RUN_OUTPUT_BUFFER_CHARS = 16_000;
export const FAILURE_MESSAGE_MAX_CHARS = 600;
/** Failures listed in the agent's tool result. */
export const AGENT_FAILURE_LIMIT = 10;

export const TEST_LOOP_PREFS = {
    maxIterations: 'ingot.agent.tests.maxIterations'
} as const;
export const DEFAULT_TEST_ITERATIONS = 5;
export const MAX_TEST_ITERATIONS_CAP = 20;

export const RUN_TESTS_TOOL = 'run_tests';
export const NO_RUNNER_TEXT = 'No test runner found. Ingot detects vitest, jest, mocha and Playwright (package.json), pytest / unittest, go test, cargo test, dotnet test, Maven, Gradle, PHPUnit, RSpec, Minitest, dart / flutter test, swift test and CTest from the project files.';
export const TESTS_GREEN_TEXT = 'All tests pass. Stop calling ingot/run_tests and give the user a short summary.';
export const TESTS_RED_TEXT = 'Fix the code (not the tests: never delete, skip or weaken a test), then call ingot/run_tests again. Pass "failedOnly": true to rerun just the failures.';
export const TESTS_CAPPED_TEXT = 'Stop: the test loop reached its iteration cap. Do not call ingot/run_tests again in this turn. Tell the user which tests still fail and why.';
