/** IDEA-261: Test Explorer and the agent's run_tests tool. */
export type TestRunner = 'vitest' | 'jest' | 'mocha' | 'playwright';
export type TestState = 'passed' | 'failed' | 'skipped';
export type TestRunStatus = 'passed' | 'failed' | 'error';

/** A test found in a file by reading its source (no runner involved). */
export interface DiscoveredTest {
    /** `<file>::<suite titles and title joined by a space>`, the same key a run result gets. */
    readonly id: string;
    readonly file: string;
    /** Suite titles, outermost first. */
    readonly suites: readonly string[];
    readonly title: string;
    readonly line: number;
}

export interface TestFile {
    /** Project-relative, forward slashes. */
    readonly path: string;
    readonly tests: readonly DiscoveredTest[];
}

export interface TestDiscovery {
    readonly runner?: TestRunner;
    /** Why that runner was picked ("scripts.test", "vitest.config.ts", "devDependencies"). */
    readonly reason?: string;
    readonly files: readonly TestFile[];
}

export interface ProjectManifest {
    /** Root file names (config files are looked up here). */
    readonly files: readonly string[];
    /** Raw package.json text, or empty. */
    readonly packageJson: string;
}

export interface TestRunRequest {
    /** Project-relative files; empty runs everything. */
    readonly files?: readonly string[];
    /** Test titles to keep (matched by the runner's name filter). */
    readonly titles?: readonly string[];
}

export interface TestResult {
    readonly id: string;
    readonly file: string;
    readonly name: string;
    readonly state: TestState;
    readonly line?: number;
    readonly durationMs?: number;
    readonly message?: string;
}

export interface TestRunResult {
    readonly runner?: TestRunner;
    readonly status: TestRunStatus;
    readonly passed: number;
    readonly failed: number;
    readonly skipped: number;
    readonly durationMs: number;
    readonly tests: readonly TestResult[];
    /** Set when the runner could not start or produced no report (compile error, missing binary). */
    readonly error?: string;
    readonly command?: string;
}

/** A Test Explorer row: a discovered test with its last result. */
export interface ExplorerTest {
    readonly id: string;
    readonly title: string;
    readonly suites: readonly string[];
    readonly line?: number;
    readonly state?: TestState;
    readonly message?: string;
    readonly durationMs?: number;
}

export interface ExplorerFile {
    readonly path: string;
    /** Failed when one test failed, passed when all that ran passed, undefined before a run. */
    readonly state?: TestState;
    readonly tests: readonly ExplorerTest[];
}

export interface RunnerCommand {
    readonly bin: string;
    readonly args: readonly string[];
    readonly env: Readonly<Record<string, string>>;
}

/** Where the agent's edit -> run_tests -> fix loop stands after a run. */
export interface TestLoopStep {
    readonly iteration: number;
    readonly max: number;
    /** The cap is reached and the run was not green: the agent must stop and explain. */
    readonly capped: boolean;
}

export interface TestService {
    discover(root: string): Promise<TestDiscovery>;
    run(root: string, request: TestRunRequest): Promise<TestRunResult>;
}

export const TestService = Symbol('IngotTestService');
