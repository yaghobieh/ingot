import type { LanguageId, ToolchainId } from '../languages/languages.types';

/** IDEA-261: Test Explorer and the agent's run_tests tool. */
export type JsTestRunner = 'vitest' | 'jest' | 'mocha' | 'playwright';
/** IDEA-313: runners of the other languages. */
export type LanguageTestRunner =
    'pytest' | 'unittest' | 'go' | 'cargo' | 'dotnet' | 'maven' | 'gradle' | 'phpunit' | 'rspec' | 'minitest' | 'dart' | 'flutter' | 'swift' | 'ctest';
export type TestRunner = JsTestRunner | LanguageTestRunner;
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
    /** IDEA-313: text of the other root manifests that name a runner (pyproject.toml, Gemfile, composer.json, pubspec.yaml, CMakeLists.txt). */
    readonly manifests?: Readonly<Record<string, string>>;
}

/** IDEA-313: how a language runner reports its results. */
export type TestReportFormat = 'junit' | 'junit-dir' | 'trx' | 'go-json' | 'dart-json' | 'rspec-json' | 'cargo-text' | 'unittest-text' | 'minitest-text' | 'swift-text';

export interface LanguageTestRunnerSpec {
    readonly runner: LanguageTestRunner;
    readonly label: string;
    readonly language: LanguageId;
    readonly toolchains: readonly ToolchainId[];
    /** Project-relative paths of test sources. */
    readonly testFile: RegExp;
    readonly format: TestReportFormat;
    /** Report folder in the project (Maven and Gradle write one XML file per class). */
    readonly reportDir?: string;
}

export interface RunnerHint {
    readonly runners: readonly LanguageTestRunner[];
    readonly pattern: RegExp;
    readonly text: string;
}

/** A result as a language runner reports it, before it is matched to a discovered test. */
export interface RawTestCase {
    readonly name: string;
    /** Class, module or group the runner names (last segment is matched against the discovered suite). */
    readonly suite?: string;
    readonly state: TestState;
    readonly file?: string;
    readonly line?: number;
    readonly durationMs?: number;
    readonly message?: string;
}

/** A language runner's command: optional steps first (configure, build), then the test command. */
export interface LanguageRunnerCommand extends RunnerCommand {
    readonly before?: readonly RunnerCommand[];
    /** Where the runner writes its report (absolute), when it writes a file. */
    readonly reportFile?: string;
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
