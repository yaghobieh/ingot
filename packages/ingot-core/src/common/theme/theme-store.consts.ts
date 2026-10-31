/** IDEA-144: color themes from Open VSX. */
export const OPEN_VSX_API = 'https://open-vsx.org/api';
export const STORE_PAGE_SIZE = 30;
export const VSIX_ROOT = 'extension/';
export const MANIFEST_PATH = `${VSIX_ROOT}package.json`;
/** Nested `include` chains deeper than this are rejected. */
export const MAX_INCLUDE_DEPTH = 4;
/** Downloaded packages kept in memory for swatches and a quick install. */
export const VSIX_CACHE_SIZE = 8;
/** Extensions in the Themes category that only ship file or product icons. */
export const ICON_THEME_PATTERN = /\bicons?\b|icon[- ]?theme|product[- ]?icon/i;

/**
 * IDEA-281: installed and imported color themes live in the Ingot config folder (~/.ingot/themes.json), so every
 * project, reload and new version sees them. They used to sit in per-project browser storage.
 */
export const USER_THEMES_FILE = 'themes.json';

/** Per-slot theme used by Light, Dark and System (System follows the OS). */
export const THEME_SLOT_PREFERENCES = {
    light: 'ingot.appearance.lightTheme',
    dark: 'ingot.appearance.darkTheme'
} as const;

export const THEME_PICKER_COMMAND = { id: 'ingot.theme.pick', label: 'Color Theme…', category: 'Ingot' } as const;
export const PREVIEW_DEBOUNCE_MS = 120;
export const SWATCH_DEBOUNCE_MS = 250;

export const FALLBACK_SWATCH = {
    light: { background: '#FFFFFF', foreground: '#1F2329', accent: '#3B6FD9' },
    dark: { background: '#1E1F22', foreground: '#DFE1E5', accent: '#5B8DEF' }
} as const;
