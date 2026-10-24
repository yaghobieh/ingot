import type { LIGHT_TOKENS } from './palette.consts';

export type TokenName = keyof typeof LIGHT_TOKENS;
export type ThemeTokens = Record<TokenName, string>;
export type UiThemeKind = 'vs' | 'vs-dark';

export interface SyntaxColors {
    readonly keyword: string;
    readonly string: string;
    readonly number: string;
    readonly comment: string;
    readonly function: string;
    readonly type: string;
    readonly property: string;
    readonly variable: string;
    readonly constant: string;
    readonly tag: string;
    readonly attribute: string;
}

export interface IngotThemeDefinition {
    readonly id: string;
    readonly label: string;
    readonly uiTheme: UiThemeKind;
    readonly tokens: ThemeTokens;
    readonly syntax: SyntaxColors;
}

export interface TokenColorRule {
    readonly scope: string[];
    readonly settings: { readonly foreground: string; readonly fontStyle?: string };
}

export interface VsCodeThemeJson {
    readonly name: string;
    readonly type: 'light' | 'dark';
    readonly colors: Record<string, string>;
    readonly tokenColors: TokenColorRule[];
}
