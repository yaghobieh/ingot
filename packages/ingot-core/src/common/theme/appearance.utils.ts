import { THEME_IDS } from './theme.consts';

/** Light / Dark / System (follows the OS, live). "custom" keeps whatever color theme the user picked. */
export const APPEARANCE_PREFERENCE = 'ingot.appearance';
export const APPEARANCE_MODES = ['system', 'light', 'dark', 'custom'] as const;
export type AppearanceMode = typeof APPEARANCE_MODES[number];
export const APPEARANCE_LABELS: Record<AppearanceMode, string> = { system: 'System', light: 'Light', dark: 'Dark', custom: 'Custom theme' };
export const DEFAULT_APPEARANCE: AppearanceMode = 'system';

export const toAppearanceMode = (value: unknown): AppearanceMode =>
    APPEARANCE_MODES.includes(value as AppearanceMode) ? value as AppearanceMode : DEFAULT_APPEARANCE;

/** Color theme to use for a mode, or undefined for "custom". */
export const themeForAppearance = (mode: AppearanceMode, osPrefersDark: boolean): string | undefined => {
    switch (mode) {
        case 'light': return THEME_IDS.light;
        case 'dark': return THEME_IDS.dark;
        case 'system': return osPrefersDark ? THEME_IDS.dark : THEME_IDS.light;
        default: return undefined;
    }
};
