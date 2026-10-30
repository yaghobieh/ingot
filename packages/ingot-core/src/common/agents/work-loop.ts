/**
 * IDEA-248: pure decisions for the agent work loop. The store runs the commands and shows the cards;
 * this module decides which checks exist, how to read a failure, and when a commit is allowed.
 */
import type { AgentToolCall } from './agent-protocol';
import { scriptCommand } from '../processes/processes.utils';
import {
    ALLOW_WEAKER_TESTS, CASE_PATTERN, CHECK_FAIL_PREFIX, CHECK_SCRIPTS, CHECKS_PASSED_PREFIX, COMMIT_BLOCKED_BRANCH, COMMIT_BLOCKED_CHECKS,
    COMMIT_CONSENT, COMMIT_INTENT, CUT_EDIT_PREFIX, CYPRESS_FILES, SHELL_GIT_BLOCKED, SHELL_GIT_WRITE, E2E_INTENT, E2E_NUDGE_PREFIX, E2E_SCRIPTS, FAILURE_LIMIT, FAILURE_MESSAGE_CHARS, FEATURE_BRANCH_PREFIXES,
    LAYOUT_WORDS, MAX_AUTO_CONTINUES, MAX_FIX_ATTEMPTS, MORE_WORK, PLAYWRIGHT_FILES, PROTECTED_BRANCHES, SKIP_PATTERN, STOP_PREFIX, TEST_PATH, UI_PATH, WORK_LOOP_INTENT
} from './work-loop.consts';
import type { CheckFailure, E2eFramework, LoopSnapshot, PlannedCheck, ProjectSignals, SummaryInput } from './work-loop.types';

/** A check that timed out into the background did not pass. */
export const checkPassed = (result: { readonly isError: boolean; readonly movedToBackground?: boolean }): boolean =>
    !result.isError && result.movedToBackground !== true;

const intentText = (prompt: string): string => prompt.replace(LAYOUT_WORDS, ' ');

export const wantsWorkLoop = (prompt: string): boolean => WORK_LOOP_INTENT.test(intentText(prompt));
export const wantsCommit = (prompt: string): boolean => COMMIT_INTENT.test(intentText(prompt));
export const wantsE2e = (prompt: string): boolean => E2E_INTENT.test(intentText(prompt));

/**
 * IDEA-282: a `git commit` or `git push` through ingot/run, when the user neither asked for one in the prompt nor
 * agreed on an ask_user card, is refused. Otherwise a blocked ingot/git commit is simply retried in the shell.
 */
export const shellGitBlockReason = (command: string, prompt: string, answers: readonly string[]): string | undefined => {
    if (!SHELL_GIT_WRITE.test(command) || wantsCommit(prompt) || /\bpush\b/i.test(intentText(prompt)) || answers.some(answer => COMMIT_CONSENT.test(answer))) {
        return undefined;
    }
    return SHELL_GIT_BLOCKED;
};

/** True when a reply that called no tool says what it will do next, so the turn should not end yet. */
export const promisesMoreWork = (reply: string, continues: number): boolean => continues < MAX_AUTO_CONTINUES && MORE_WORK.test(reply);

/** The reply hit the output limit inside an edit block, so that file was not saved. */
export const cutEditNudge = (path: string): string =>
    `${CUT_EDIT_PREFIX} The <<<EDIT block for ${path} never closed, so ${path} was NOT saved. Send ${path} again as one complete block, with at most a few files per reply, then continue the task.`;
export const userAllowsWeakerTests = (prompt: string): boolean => ALLOW_WEAKER_TESTS.test(prompt);

export const isTestPath = (path: string): boolean => TEST_PATH.test(path);
export const isUiPath = (path: string): boolean => UI_PATH.test(path) || path.split('/').includes('e2e');

export const isProtectedBranch = (branch: string): boolean => {
    const name = branch.trim();
    return !name || (PROTECTED_BRANCHES as readonly string[]).includes(name) || name.startsWith('release/');
};

export const isFeatureBranch = (branch: string): boolean => FEATURE_BRANCH_PREFIXES.some(prefix => branch.trim().startsWith(prefix));

export const planFromEdits = (paths: readonly string[]): string[] => [
    ...paths.map(path => `Edit ${path}`),
    'Run the project checks and fix failures',
    'Commit on a feature branch when the checks pass'
];

export const detectE2eFramework = (files: readonly string[]): E2eFramework | undefined => {
    const names = new Set(files);
    if (PLAYWRIGHT_FILES.some(name => names.has(name))) {
        return 'playwright';
    }
    if (CYPRESS_FILES.some(name => names.has(name))) {
        return 'cypress';
    }
    return undefined;
};

const manifestChecks = (files: readonly string[]): PlannedCheck[] => {
    const names = new Set(files);
    if (names.has('pyproject.toml')) {
        return [{ id: 'pytest', command: 'python -m pytest', label: 'pytest' }];
    }
    if (names.has('Makefile')) {
        return [{ id: 'make-test', command: 'make test', label: 'make test' }];
    }
    if (names.has('go.mod')) {
        return [{ id: 'go-test', command: 'go test ./...', label: 'go test' }];
    }
    if (names.has('Cargo.toml')) {
        return [{ id: 'cargo-test', command: 'cargo test', label: 'cargo test' }];
    }
    if (names.has('pom.xml')) {
        return [{ id: 'mvn-test', command: 'mvn -q test', label: 'Maven test' }];
    }
    if (names.has('build.gradle') || names.has('build.gradle.kts')) {
        return [{ id: 'gradle-test', command: './gradlew test', label: 'Gradle test' }];
    }
    return [];
};

/** Checks to run after an edit. `gate` stands in for lint, typecheck and test. Hooks stay on the commit. */
export const detectChecks = (signals: ProjectSignals, includeE2e: boolean): PlannedCheck[] => {
    const scripts = signals.scripts;
    const manager = signals.manager ?? 'npm';
    const names = Object.keys(scripts);
    const picked: PlannedCheck[] = [];
    if (names.includes('gate')) {
        picked.push({ id: 'gate', command: scriptCommand(manager, 'gate'), label: 'gate' });
    } else {
        for (const name of CHECK_SCRIPTS) {
            if (name !== 'gate' && names.includes(name)) {
                picked.push({ id: name, command: scriptCommand(manager, name), label: name });
            }
        }
    }
    if (includeE2e) {
        const e2e = E2E_SCRIPTS.find(name => names.includes(name));
        if (e2e && !picked.some(check => check.id === e2e)) {
            picked.push({ id: e2e, command: scriptCommand(manager, e2e), label: e2e });
        }
    }
    return picked.length ? picked : manifestChecks(signals.files);
};

export const withCheckEnv = (command: string, platform = typeof process === 'undefined' ? 'linux' : process.platform): string =>
    platform === 'win32' || command.startsWith('CI=') ? command : `CI=1 ${command}`;

const clip = (text: string): string => text.trim().slice(0, FAILURE_MESSAGE_CHARS);

/** File, line and message from compiler and test output. Exit code decides pass or fail. */
export const parseCheckFailures = (output: string): CheckFailure[] => {
    const found: CheckFailure[] = [];
    for (const raw of output.split('\n')) {
        const line = raw.trim();
        if (!line) {
            continue;
        }
        const located = /^(.*?):(\d+)(?::\d+)?:\s*(.*)$/.exec(line);
        const loose = located ? undefined : /([A-Za-z0-9_./\\-]+\.[A-Za-z0-9]+):(\d+)(?::\d+)?/.exec(line);
        const failed = /^(?:not ok|FAIL\b|error:|Error:|AssertionError|failed\b)/i.test(line);
        if (!located && !loose && !failed) {
            continue;
        }
        const file = (located?.[1] ?? loose?.[1])?.replace(/\\/g, '/');
        const lineNo = located?.[2] ?? loose?.[2];
        found.push({
            file: file || undefined,
            line: lineNo ? Number(lineNo) : undefined,
            message: clip(located?.[3] || line)
        });
        if (found.length >= FAILURE_LIMIT) {
            break;
        }
    }
    if (!found.length) {
        const last = output.split('\n').map(item => item.trim()).filter(Boolean).pop();
        if (last) {
            found.push({ message: clip(last) });
        }
    }
    return found;
};

export const formatFailures = (failures: readonly CheckFailure[]): string => failures.map(failure => {
    const where = failure.file ? `${failure.file}${failure.line ? `:${failure.line}` : ''}: ` : '';
    return `- ${where}${failure.message}`;
}).join('\n');

export const testCaseCount = (source: string): number => source.match(CASE_PATTERN)?.length ?? 0;
export const skipCount = (source: string): number => source.match(SKIP_PATTERN)?.length ?? 0;

/** True when the new test file drops cases or adds a skip. A brand-new file is not weaker. */
export const weakensTests = (before: string, after: string): boolean => {
    if (!before.trim()) {
        return false;
    }
    return skipCount(after) > skipCount(before) || testCaseCount(after) < testCaseCount(before);
};

export const checkFailNudge = (command: string, output: string, attempt: number): string => [
    CHECK_FAIL_PREFIX,
    `Attempt ${attempt} of ${MAX_FIX_ATTEMPTS}. \`${command}\` failed. Fix the code. Do not delete or weaken tests.`,
    formatFailures(parseCheckFailures(output)) || output.trim().slice(-FAILURE_MESSAGE_CHARS)
].join('\n');

export const checksPassedNudge = (branch: string, commands: readonly string[]): string => [
    CHECKS_PASSED_PREFIX,
    `Checks green (${commands.join(', ') || 'none'}).`,
    isFeatureBranch(branch)
        ? `Commit on ${branch} with ingot/git (add, then commit). Do not commit if a hook fails: fix it and commit again.`
        : `You are on "${branch || 'an unknown branch'}". Create a feature/ or bug/ branch with ingot/git {"op":"branch","name":"feature/<short>","checkout":true}, then add and commit.`
].join(' ');

export const e2eNudge = (framework: E2eFramework): string => [
    E2E_NUDGE_PREFIX,
    `This project uses ${framework}. Add or update an end-to-end test for the change (a data-testid where the page has no stable hook), then the checks will run it. A bug fix needs a test that fails before the fix and passes after.`
].join(' ');

export const stopMessage = (output: string): string => [
    STOP_PREFIX,
    'The same checks failed three times. Nothing was committed.',
    formatFailures(parseCheckFailures(output))
].filter(Boolean).join('\n');

export const needsE2eNudge = (snapshot: LoopSnapshot, framework: E2eFramework | undefined, prompt: string, editedPaths: readonly string[]): boolean => {
    if (!framework || snapshot.e2eNudged || !wantsE2e(prompt)) {
        return false;
    }
    return !editedPaths.some(path => isTestPath(path) || path.split('/').includes('e2e'));
};

/**
 * Why an agent commit must not run, or undefined when it may.
 * Protected branches (master, main, release/*) never receive an agent commit.
 * A work-loop task also needs a feature/ or bug/ branch and green checks.
 */
export const commitBlockReason = (branch: string, snapshot: LoopSnapshot, required: readonly string[]): string | undefined => {
    if (isProtectedBranch(branch) || (snapshot.wants && !isFeatureBranch(branch))) {
        return `${COMMIT_BLOCKED_BRANCH} Current branch: "${branch || '(none)'}". Create a feature/ or bug/ branch, then commit there.`;
    }
    if (!snapshot.wants || !required.length) {
        return undefined;
    }
    const passed = new Set(snapshot.checks.filter(check => check.passed).map(check => check.command));
    const missing = required.filter(command => !passed.has(command));
    if (missing.length) {
        return `${COMMIT_BLOCKED_CHECKS} Run ${missing.join(', ')} and fix failures before committing.`;
    }
    return undefined;
};

export const summaryText = (input: SummaryInput): string => {
    const checks = input.checks.length
        ? input.checks.map(check => `${check.command} ${check.passed ? 'passed' : 'failed'}`).join(', ')
        : 'none';
    return [
        `Files: ${input.files.join(', ') || 'none'}`,
        `Checks: ${checks}`,
        `Branch: ${input.branch || '(none)'}`,
        `Result: ${input.result}`
    ].join('\n');
};

export const WORK_LOOP_PROTOCOL = [
    'Work loop, whenever you change project files:',
    '- Before changing more than one file, start with a PLAN: list (files, steps, and the tests you will run or add).',
    '- After the edits, run the project checks with ingot/run or ingot/run_script (package scripts named gate, test, lint, typecheck or e2e; otherwise pytest, make test, go test, cargo test, Maven or Gradle).',
    '- If a check fails, read the file and line, fix the code, and run it again. Stop after 3 failures and explain. Never delete a test, skip a test, or weaken an assertion to make it pass.',
    '- If the project already has end-to-end tests (Playwright or Cypress), add or update one for a feature or UI change and run it. For a bug, add a test that fails before the fix and passes after.',
    '- Commit only when the user asked for a commit, with ingot/git (never git commands through ingot/run), only on a feature/ or bug/ branch, and only when the checks and the .ingot pre-commit hooks pass. Never commit on master, main or release/*.',
    '- Then give a short summary: files, checks, branch, result.'
].join('\n');

const CODE_ARG = ['path', 'owner', 'repo', 'ref'] as const;

/** A GitHub or web fetch that would read repository code. Profile lookups are not code fetches. */
export const isRemoteCodeFetch = (call: AgentToolCall): boolean => {
    const url = typeof call.args.url === 'string' ? call.args.url : '';
    if ((call.tool === 'web_fetch' || call.tool === 'web_search') && /github\.com|githubusercontent\.com/i.test(url)) {
        return true;
    }
    if (!/github/i.test(call.server)) {
        return false;
    }
    if (/file|content|search_code|blob|tree|raw/i.test(call.tool)) {
        return true;
    }
    return CODE_ARG.some(key => {
        const value = call.args[key];
        return typeof value === 'string' && value.trim().length > 0;
    });
};

export const userAskedForRemote = (prompt: string): boolean =>
    /\b(github|pull request|\bprs?\b|issues?|remote|on the web|fetch)\b/i.test(prompt);
