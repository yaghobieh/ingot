/** IDEA-248: the agent plan → edit → check → fix → commit loop. */

/** Edits in one reply that must show a plan card first. */
export const MULTI_FILE_EDITS = 2;
/** Failed check runs before the agent stops and explains. */
export const MAX_FIX_ATTEMPTS = 3;
/** Hard cap for the tool-round preference. */
export const MAX_TOOL_ROUNDS_CAP = 30;
/** Characters of a tool result kept for the next model turn. */
export const DEFAULT_TOOL_RESULT_CHARS = 16_000;

export const WORK_LOOP_PREFS = {
    enabled: 'ingot.agent.workLoop',
    maxToolRounds: 'ingot.agent.maxToolRounds',
    maxToolResultChars: 'ingot.agent.maxToolResultChars'
} as const;

/** Package scripts treated as the project's checks, in the order they run. `gate` replaces the rest. */
export const CHECK_SCRIPTS = ['gate', 'test', 'lint', 'typecheck'] as const;
export const E2E_SCRIPTS = ['e2e', 'test:e2e'] as const;

export const PROTECTED_BRANCHES = ['master', 'main'] as const;
export const FEATURE_BRANCH_PREFIXES = ['feature/', 'bug/'] as const;

export const CHECK_FAIL_PREFIX = 'Check failed.';
export const CHECKS_PASSED_PREFIX = 'Checks passed.';
export const E2E_NUDGE_PREFIX = 'Add an end-to-end test.';
export const STOP_PREFIX = 'Stopped after 3 failed check runs.';
export const TOOL_ROUNDS_STOP = 'Stopped: the agent used its tool rounds. Send another message to continue.';
export const COMMIT_BLOCKED_BRANCH = 'Commit blocked: this branch is protected.';
export const COMMIT_BLOCKED_CHECKS = 'Commit blocked: checks have not passed.';
export const REVIEW_THEN_CHECKS = 'Accept the edits and the checks will run.';

export const REMOTE_BLOCKED = 'Blocked: read this project from the open workspace with ingot/list_dir, ingot/read_file, ingot/glob and ingot/grep. Call GitHub or fetch a remote only when the user asks for the remote, and never guess a repository URL.';

/** Tasks that should close the loop (checks, fixes, commit). Small edits and questions do not. */
export const WORK_LOOP_INTENT = /\b(fix|implement|ship|commit|bug|feature|playwright|cypress|e2e)\b/i;
export const E2E_INTENT = /\b(feature|ui|page|screen|playwright|cypress|e2e)\b/i;
export const COMMIT_INTENT = /\b(fix|implement|ship|commit|bug|feature)\b/i;
export const ALLOW_WEAKER_TESTS = /\b(remove|delete|skip|weaken)\b[^.]{0,40}\btests?\b/i;
/** A folder layout ("feature folders") or a path ("/tmp/my-e2e-app") names no feature to ship, so intent checks ignore it. */
export const LAYOUT_WORDS = /\bfeature[- ]folders?\b|(?:^|\s)(?:\/|~\/|\.\/)\S*/gi;
export const CUT_EDIT_PREFIX = 'Your last reply was cut off.';
/** A reply that stops while saying what it does next ("Next: the routes", "then I'll run npm test"). */
export const MORE_WORK = /(?:^|\n)\s*(?:#+\s*)?next\b|\bnext,? I(?:'|’)ll\b|\bthen I(?:'|’)ll\b|\bI(?:'|’)ll (?:now |next |then )?(?:run|add|write|create|wire|install|build|test|set up|scaffold)\b|\bcomes? next\b|\bnext (?:reply|message|turn)\b|\bstill (?:need|to do)\b|\bremaining (?:files|steps|work)\b/i;
export const EMPTY_REPLY_NUDGE = 'Your last reply was empty. Answer the request now: start the work with edit blocks or tool blocks.';
export const CONTINUE_NUDGE = 'Continue now with the next step: write the files with edit blocks and run the commands with tool blocks yourself. Do not stop until the task is complete and verified.';
/** `git commit` / `git push` typed into ingot/run, which would skip the ingot/git branch, checks and hook rules. */
export const SHELL_GIT_WRITE = /\bgit\b(?:\s+-c\s+\S+)*\s+(commit|push)\b/i;
/** An ask_user answer that agrees to a commit. */
export const COMMIT_CONSENT = /\b(yes|commit|go ahead|ok(?:ay)?)\b/i;
export const SHELL_GIT_BLOCKED = 'Blocked: the user did not ask for a commit or push. Do not commit; finish the task and summarize. Commits and pushes go through ingot/git when the user asks.';
/** Hidden "continue" nudges per turn; the tool-round limit still applies. */
export const MAX_AUTO_CONTINUES = 12;

export const UI_PATH = /\.(tsx|jsx|vue|svelte|css|html)$/i;
export const TEST_PATH = /\.(?:test|spec)\.(?:[cm]?[jt]sx?)$/i;
export const SKIP_PATTERN = /\b(?:it|test|describe)\.skip\s*\(|\bxit\s*\(|\bxdescribe\s*\(/g;
export const CASE_PATTERN = /\b(?:it|test)\s*\(/g;

export const PLAYWRIGHT_FILES = ['playwright.config.ts', 'playwright.config.js', 'playwright.config.mjs'] as const;
export const CYPRESS_FILES = ['cypress.config.ts', 'cypress.config.js', 'cypress.config.mjs'] as const;

export const RG_TIMEOUT_MS = 15_000;
export const FAILURE_LIMIT = 12;
export const FAILURE_MESSAGE_CHARS = 200;
