import { THEME_IDS } from './theme.consts';

/** Light / Dark / System (follows the OS, live). "custom" keeps whatever color theme the user picked. */
export const APPEARANCE_PREFERENCE = 'ingot.appearance';
export const APPEARANCE_MODES = ['system', 'light', 'dark', 'custom'] as const;
export type AppearanceMode = typeof APPEARANCE_MODES[number];
export const APPEARANCE_LABELS: Record<AppearanceMode, string> = { system: 'System', light: 'Light', dark: 'Dark', custom: 'Custom theme' };
export const DEFAULT_APPEARANCE: AppearanceMode = 'system';

export const toAppearanceMode = (value: unknown): AppearanceMode =>
    APPEARANCE_MODES.includes(value as AppearanceMode) ? value as AppearanceMode : DEFAULT_APPEARANCE;

/** IDEA-144: the theme picked for the Light and the Dark slot (System uses the one matching the OS). */
export interface ThemeSlots {
    readonly light?: string;
    readonly dark?: string;
}

/** Color theme to use for a mode, or undefined for "custom". */
export const themeForAppearance = (mode: AppearanceMode, osPrefersDark: boolean, slots: ThemeSlots = {}): string | undefined => {
    const light = slots.light || THEME_IDS.light;
    const dark = slots.dark || THEME_IDS.dark;
    switch (mode) {
        case 'light': return light;
        case 'dark': return dark;
        case 'system': return osPrefersDark ? dark : light;
        default: return undefined;
    }
};

/** The slot a picker edits for the current mode; "custom" edits the color theme directly. */
export const slotForAppearance = (mode: AppearanceMode, osPrefersDark: boolean): 'light' | 'dark' | undefined =>
    mode === 'light' ? 'light' : mode === 'dark' ? 'dark' : mode === 'system' ? (osPrefersDark ? 'dark' : 'light') : undefined;
