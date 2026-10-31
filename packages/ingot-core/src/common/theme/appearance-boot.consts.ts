/**
 * IDEA-281: the last applied color theme, cached in localStorage so the next start paints it before preferences load.
 * The user settings file stays the source of truth; this cache only avoids a flash of the wrong theme.
 * applications/*\/resources/preload.html reads the same key and attribute.
 */
export const APPEARANCE_BOOT_KEY = 'ingot.appearance.boot';
export const BOOT_THEME_ATTRIBUTE = 'data-ingot-boot';
export const THEME_KIND_ATTRIBUTE = 'data-theme';
