export type ThemeKind = 'light' | 'dark';

export interface AppearanceBoot {
    readonly themeId: string;
    readonly kind: ThemeKind;
}
