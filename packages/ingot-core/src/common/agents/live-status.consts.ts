import { CODEBASE_SEARCH_TOOL } from '../codebase-index/codebase-index.consts';
import { WORKING_LABEL } from './agents.consts';
import { CODE_EDIT_TOOLS } from './code-tools.consts';
import { TASK_TOOL } from './subagent-task.consts';
import type { CommandKind, LiveStatusKind } from './live-status.types';

/** Fixed live status lines; the ones naming a file or a command are built in `live-status.ts`. */
export const LIVE_STATUS_TEXT = {
    waiting: 'Thinking…',
    typing: 'Typing…',
    exploring: 'Exploring the project…',
    searching: 'Searching the codebase…',
    web: 'Searching the web…',
    testing: 'Running tests…',
    checks: 'Running checks…',
    building: 'Building…',
    installing: 'Installing packages…',
    serving: 'Starting the dev server…',
    git: 'Checking git…',
    commit: 'Committing…',
    push: 'Pushing…',
    browser: 'Checking the browser…',
    subagents: 'Working with subagents…',
    'checking-plan': 'Checking the plan…',
    'wrapping-up': 'Almost there…',
    working: WORKING_LABEL
} as const satisfies Partial<Record<LiveStatusKind | 'commit' | 'push', string>>;

export const READING_WORD = 'Reading';
export const RUNNING_WORD = 'Running';
export const DELETING_WORD = 'Deleting';
export const ELLIPSIS = '…';
/** "Reading a file…" when a read names no path. */
export const SOME_FILE = 'a file';

/** First match wins: `npm run test:e2e` is tests, not a build. */
export const COMMAND_KINDS: readonly { readonly kind: CommandKind; readonly pattern: RegExp }[] = [
    { kind: 'testing', pattern: /\b(?:test|tests|vitest|jest|mocha|pytest|playwright|e2e|spec)\b/i },
    { kind: 'checks', pattern: /\b(?:lint|eslint|tsc|typecheck|type-check|gate|prettier|check)\b/i },
    { kind: 'building', pattern: /\b(?:build|bundle|compile|webpack)\b/i },
    { kind: 'installing', pattern: /\b(?:npm|pnpm|yarn|bun)\s+(?:install|i|ci|add)\b|\bpip3?\s+install\b/i },
    { kind: 'serving', pattern: /\b(?:npm|pnpm|yarn|bun)\s+(?:run\s+)?(?:dev|serve|start|preview)\b/i }
];

/** "Running npm run hello…": the program and its plain words, up to the first flag or quoted argument. */
export const COMMAND_MAX_WORDS = 3;
export const COMMAND_MAX_CHARS = 28;
export const COMMAND_STOP_RE = /^[-"'`$|&;<>(]/;

export const READ_TOOL = 'read_file';
export const LIST_TOOL = 'list_dir';
export const SEARCH_TOOLS: readonly string[] = ['grep', 'glob', CODEBASE_SEARCH_TOOL, 'go_to_definition', 'find_references'];
export const WEB_TOOLS: readonly string[] = ['web_search', 'web_fetch'];
export const RUN_TOOLS = { run: 'run', script: 'run_script', tests: 'run_tests', diagnostics: 'diagnostics' } as const;
export const EDIT_TOOLS: readonly string[] = CODE_EDIT_TOOLS;
export const DELETE_TOOL = 'delete';
export const GIT_TOOL = 'git';
export const GIT_OPS = { commit: 'commit', push: 'push' } as const;
export const BROWSER_TOOL_PREFIX = 'browser_';
export const SUBAGENT_TOOL = TASK_TOOL;
export const SCRIPT_RUNNER = 'npm run';

/**
 * Each line stays up at least this long, so a burst of quick tool calls reads as steps instead of flicker.
 * The line that ends a run is held just as long, so the last step is seen.
 */
export const LIVE_STATUS_MIN_MS = 450;
