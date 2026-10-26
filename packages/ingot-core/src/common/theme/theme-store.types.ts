import type { ImportedTheme } from './theme-import.utils';

/** A color theme extension from the Open VSX search (IDEA-144). */
export interface StoreThemeExtension {
    /** `namespace.name` */
    readonly id: string;
    readonly namespace: string;
    readonly name: string;
    readonly displayName: string;
    readonly description: string;
    readonly version: string;
    readonly downloads: number;
    readonly rating?: number;
    readonly reviewCount: number;
    readonly iconUrl?: string;
    readonly downloadUrl: string;
}

export interface ThemeSwatch {
    readonly background: string;
    readonly foreground: string;
    readonly accent: string;
    readonly syntax: readonly string[];
}

/** Where an installed theme came from; absent for themes imported from a file. */
export interface ThemeSource {
    readonly extensionId: string;
    readonly version: string;
    readonly publisher: string;
}

export interface StoreInstalledTheme extends ImportedTheme {
    readonly source?: ThemeSource;
}

/** A `contributes.themes` entry of an extension manifest. */
export interface ThemeContribution {
    readonly label: string;
    readonly uiTheme: ImportedTheme['uiTheme'];
    /** Path inside the .vsix, e.g. `extension/themes/dark.json`. */
    readonly path: string;
}

export interface PickerTheme {
    readonly id: string;
    readonly label: string;
    readonly uiTheme: string;
    readonly description?: string;
    readonly removable?: boolean;
    readonly extensionId?: string;
}

export interface GroupedThemes {
    readonly light: PickerTheme[];
    readonly dark: PickerTheme[];
}

export type ThemeSlot = 'light' | 'dark';
