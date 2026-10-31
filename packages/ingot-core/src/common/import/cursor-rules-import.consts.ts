/** IDEA-281: Cursor rule files. `.cursorrules` lands in `.ingot/rules/cursorrules.md`; the loader then skips the original. */
export const CURSOR_RULES_FILE = '.cursorrules';
export const CURSOR_RULES_IMPORTED_NAME = 'cursorrules';

/** IDEA-287: whether opening a workspace with Cursor config asks how to use it (`never` turns the question off everywhere). */
export const CURSOR_IMPORT_PREFERENCE = 'ingot.import.cursorRules';
export const CURSOR_IMPORT_MODES = ['ask', 'never'] as const;
export const DEFAULT_CURSOR_IMPORT_MODE = 'ask';
