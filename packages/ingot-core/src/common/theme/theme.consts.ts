import { DARCULA_TOKENS, DARK_TOKENS, LIGHT_TOKENS } from './palette.consts';
import type { IngotThemeDefinition, SyntaxColors } from './theme.types';

export const THEME_IDS = {
    light: 'ingot-light',
    dark: 'ingot-dark',
    darcula: 'ingot-darcula'
} as const;

export const LIGHT_SYNTAX: SyntaxColors = {
    keyword: '#0033B3', string: '#067D17', number: '#1750EB', comment: '#8C8C8C', function: '#00627A',
    type: '#000000', property: '#871094', variable: '#1F2329', constant: '#871094', tag: '#0033B3', attribute: '#174AD4'
};

export const DARK_SYNTAX: SyntaxColors = {
    keyword: '#CF8E6D', string: '#6AAB73', number: '#2AACB8', comment: '#8C9096', function: '#56A8F5',
    type: '#BCBEC4', property: '#C77DBB', variable: '#BCBEC4', constant: '#C77DBB', tag: '#D5B778', attribute: '#BABABA'
};

export const DARCULA_SYNTAX: SyntaxColors = {
    keyword: '#CC7832', string: '#6A8759', number: '#6897BB', comment: '#808080', function: '#FFC66D',
    type: '#A9B7C6', property: '#9876AA', variable: '#A9B7C6', constant: '#9876AA', tag: '#E8BF6A', attribute: '#BABABA'
};

export const INGOT_THEMES: readonly IngotThemeDefinition[] = [
    { id: THEME_IDS.light, label: 'Ingot Light', uiTheme: 'vs', tokens: LIGHT_TOKENS, syntax: LIGHT_SYNTAX },
    { id: THEME_IDS.dark, label: 'Ingot Dark', uiTheme: 'vs-dark', tokens: DARK_TOKENS, syntax: DARK_SYNTAX },
    { id: THEME_IDS.darcula, label: 'Ingot Darcula', uiTheme: 'vs-dark', tokens: DARCULA_TOKENS, syntax: DARCULA_SYNTAX }
];

/** Alpha suffixes used when deriving translucent colors from tokens. */
export const ALPHA = {
    hover: '14',
    subtle: '0F',
    strong: '33',
    scrollbar: '40',
    scrollbarHover: '66'
} as const;

/** Agent / VCS diff backgrounds from the design reference. */
export const DIFF = {
    added: '#5FAD562E',
    addedText: '#5FAD564D',
    removed: '#F7546429',
    removedText: '#F754644D'
} as const;
