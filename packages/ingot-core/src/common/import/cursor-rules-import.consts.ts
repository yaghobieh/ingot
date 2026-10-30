/** IDEA-281: one-time "Import Cursor rules into .ingot?" prompt for projects that carry Cursor rule files. */
export const CURSOR_RULES_FILE = '.cursorrules';
/** `.cursorrules` lands in `.ingot/rules/cursorrules.md`; the loader then skips the original so it is not read twice. */
export const CURSOR_RULES_IMPORTED_NAME = 'cursorrules';
export const IMPORTED_RULE_EXTENSION = '.md';

export const CURSOR_IMPORT_PREFERENCE = 'ingot.import.cursorRules';
export const CURSOR_IMPORT_MODES = ['ask', 'never'] as const;
export const DEFAULT_CURSOR_IMPORT_MODE = 'ask';

export const CURSOR_IMPORT_PROMPT = 'Import Cursor rules into .ingot?';
export const CURSOR_IMPORT_ANSWERS = { import: 'Import', notNow: 'Not now', never: 'Never' } as const;
export const CURSOR_IMPORT_COMMAND = { id: 'ingot.import.cursorRules', label: 'Import Cursor Rules into .ingot', category: 'Ingot' } as const;

/** Workspace-scoped storage key; "Not now" keeps the prompt away for this project for a day. */
export const CURSOR_IMPORT_SNOOZE_KEY = 'ingot.import.cursorRules.snoozedAt';
export const CURSOR_IMPORT_SNOOZE_MS = 24 * 60 * 60 * 1000;
