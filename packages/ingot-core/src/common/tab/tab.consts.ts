import type { TabLimits } from './tab.types';

/** Tab next-edit prediction settings (IDEA-285). The model itself is picked with `ingot.autocomplete.model`. */
export const TAB_PREFERENCES = {
    enabled: 'ingot.tab.enabled',
    debounceMs: 'ingot.tab.debounceMs',
    maxRequestsPerDay: 'ingot.tab.maxRequestsPerDay',
    maxTokensPerDay: 'ingot.tab.maxTokensPerDay',
    devOpenRouter: 'ingot.tab.devOpenRouter.enabled',
    devOpenRouterModel: 'ingot.tab.devOpenRouter.model'
} as const;

export const TAB_DEFAULT_DEBOUNCE_MS = 300;
export const TAB_MIN_DEBOUNCE_MS = 50;
export const TAB_DEFAULT_LIMITS: TabLimits = { maxRequestsPerDay: 500, maxTokensPerDay: 300_000 };
/** Cheap, fast fill-in-the-middle model used by the OpenRouter dev fallback. */
export const TAB_DEFAULT_DEV_MODEL = 'mistralai/codestral-2508';
/** Catalog entry whose provider (OpenRouter) carries the dev fallback; its model name is overridden per request. */
export const TAB_DEV_CATALOG_MODEL = 'openrouter-auto';

/** Feature tag the Ingot gateway uses for usage breakdowns. */
export const TAB_FEATURE = 'tab';
export const TAB_MAX_OUTPUT_TOKENS = 160;
export const TAB_TEMPERATURE = 0;
export const TAB_PREFIX_LINES = 80;
export const TAB_SUFFIX_LINES = 30;
export const TAB_RECENT_EDITS_MAX = 5;
export const TAB_RECENT_EDIT_MAX_CHARS = 160;
/** Rough characters-per-token ratio for budgeting; the gateway meters the real count. */
export const TAB_CHARS_PER_TOKEN = 4;
/** A next-edit snippet shorter than this matches too many lines to be useful. */
export const TAB_MIN_NEXT_SNIPPET = 3;
/** A reply that repeats a whole identifier of at least this length before the cursor has it dropped. */
export const TAB_MIN_WORD_OVERLAP = 3;
export const TAB_MAX_OVERLAP = 40;

export const TAB_CURSOR = '<CURSOR>';
export const TAB_NEXT_MARKER = '<<NEXT>>';
export const TAB_SYSTEM_PROMPT = [
    'You are Ingot Tab, a next-edit prediction engine inside a code editor.',
    `You get the code around the cursor with a ${TAB_CURSOR} marker and the user's most recent edits in this file.`,
    `Reply with only the text to insert at ${TAB_CURSOR} (it may be empty): no explanations, no markdown fences, never repeat code that is already before or after the cursor.`,
    `If the recent edits mean another line of this file must change as well (a renamed symbol, a new parameter, a matching call), end with one extra line: ${TAB_NEXT_MARKER} followed by the exact current text of that line. Otherwise do not add it.`
].join(' ');

/** Files that never leave the machine, on top of the workspace `.ingotignore`. */
export const TAB_IGNORE_FILE = '.ingotignore';
export const TAB_DEFAULT_IGNORE: readonly string[] = ['.env', '.env.*', '*.pem', '*.key', 'id_rsa*', 'ingot.config.json', '.ingotignore'];
/** Editor documents Tab may read; output panes, diffs and settings views are skipped. */
export const TAB_SCHEMES: readonly string[] = ['file', 'untitled'];

export const TAB_USAGE_STORAGE_KEY = 'ingot.tab.usage';
