/** IDEA-303: frozen zones are shared with the team, so `.ingot/frozen.json` is meant to be committed. */
export const FROZEN_FILE = '.ingot/frozen.json';
export const FROZEN_FILE_VERSION = 1;
export const SYMBOL_SEPARATOR = ' › ';

/** Rejected agent edits to one file before Ingot suggests freezing it. */
export const DEFAULT_REVERT_THRESHOLD = 3;
/** Inference: files whose last commit is at least this old (and whose tests are green) are stable. */
export const DEFAULT_INFER_MIN_AGE_DAYS = 30;
export const DAY_MS = 86_400_000;
export const MAX_INFER_CANDIDATES = 20;
export const INFER_TEST_TIMEOUT_MS = 120_000;
export const TEST_FILE_GLOB = '**/*.{test,spec}.{ts,tsx,js,jsx,mjs,cjs,py}';

export const FROZEN_PREFS = {
    revertThreshold: 'ingot.frozen.revertThreshold',
    inferMinAgeDays: 'ingot.frozen.inferMinAgeDays'
} as const;

/** Declarations whose name is in group `name`; checked top to bottom on one line. */
export const DECLARATIONS: readonly RegExp[] = [
    /^\s*(?:export\s+)?(?:default\s+)?(?:async\s+)?function\s*\*?\s*(?<name>[A-Za-z_$][\w$]*)\s*[<(]/,
    /^\s*(?:export\s+)?(?:const|let|var)\s+(?<name>[A-Za-z_$][\w$]*)\s*(?::[^=]+)?=\s*(?:async\s+)?(?:function\b|\(|[A-Za-z_$][\w$]*\s*=>)/,
    /^\s*(?:export\s+)?(?:default\s+)?(?:abstract\s+)?class\s+(?<name>[A-Za-z_$][\w$]*)/,
    /^\s*(?:(?:public|private|protected|static|async|override|readonly|get|set)\s+)*(?<name>[A-Za-z_$][\w$]*)\s*(?:<[^>]*>)?\([^;]*\)\s*(?::\s*[^{;]+)?\{\s*$/,
    /^\s*(?:async\s+)?def\s+(?<name>[A-Za-z_]\w*)\s*\(/,
    /^\s*(?:pub\s+)?fn\s+(?<name>[A-Za-z_]\w*)/,
    /^\s*func\s+(?:\([^)]*\)\s*)?(?<name>[A-Za-z_]\w*)\s*\(/
];
/** Words that look like a method call at the start of a line but are not declarations. */
export const NOT_DECLARATIONS = new Set(['if', 'for', 'while', 'switch', 'catch', 'return', 'function', 'else', 'do', 'try', 'with']);

export const TEST_COMMAND = /\b(?:test|tests|vitest|jest|mocha|ava|pytest|go test|cargo test|playwright)\b/i;

export const FROZEN_NOTES = { frozen: 'Frozen', unfrozen: 'Unfrozen', habit: 'Saved to Habits' } as const;
export const FROZEN_ASK_OPTIONS = { keep: 'Keep it frozen', allow: 'Allow this edit', unfreeze: 'Unfreeze' } as const;
export const FROZEN_SOURCE_LABELS = { user: 'by you', inferred: 'stable: green tests + age', learned: 'you kept reverting it' } as const;

export const FROZEN_SETTINGS_PAGE = 'frozen';
export const FROZEN_COMMANDS = {
    freezeFile: { id: 'ingot.frozen.freezeFile', label: 'Freeze for Agents', category: 'Ingot' },
    unfreezeFile: { id: 'ingot.frozen.unfreezeFile', label: 'Unfreeze for Agents', category: 'Ingot' },
    freezeSymbol: { id: 'ingot.frozen.freezeSymbol', label: 'Freeze Function for Agents', category: 'Ingot' },
    infer: { id: 'ingot.frozen.infer', label: 'Freeze Stable Files (Green Tests + Age)…', category: 'Ingot' },
    open: { id: 'ingot.frozen.open', label: 'Show Frozen Zones', category: 'Ingot' }
} as const;
