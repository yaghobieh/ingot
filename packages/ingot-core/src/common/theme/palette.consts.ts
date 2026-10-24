/* Brand colours from assets/brand/palette.json; UI tokens follow JetBrains Int UI / Islands with Ingot accents. */
export const BRAND = {
    'ingotGold': '#D9A04E',
    'ingotGoldDeep': '#B9772A',
    'ingotGoldLight': '#F3D29A',
    'forgeBlue': '#3B6FD9',
    'forgeNavy': '#1B2647',
    'caretInk': '#1C2440'
} as const;

export const LIGHT_TOKENS = {
    'bg': '#F7F8FA',
    'surface': '#FFFFFF',
    'panel': '#DFE1E5',
    'toolbar': '#F7F8FA',
    'border': '#EBECF0',
    'text': '#1E1F22',
    'textMuted': '#6C707E',
    'primary': '#3B6FD9',
    'primaryHover': '#2F5DBF',
    'primaryText': '#FFFFFF',
    'selection': '#D5E1FF',
    'focusRing': '#8FB0F0',
    'accent': '#C9822E',
    'success': '#208A3C',
    'warning': '#C27D04',
    'danger': '#DB3B4B',
    'info': '#2F7FB8',
    'editorBg': '#FFFFFF',
    'editorLineHighlight': '#F5F8FE',
    'editorGutter': '#AEB3C2'
} as const;

export const DARK_TOKENS = {
    'bg': '#2B2D30',
    'surface': '#2B2D30',
    'panel': '#34363A',
    'toolbar': '#2B2D30',
    'border': '#393B40',
    'text': '#DFE1E5',
    'textMuted': '#9DA0A8',
    'primary': '#3574F0',
    'primaryHover': '#548AF7',
    'primaryText': '#FFFFFF',
    'selection': '#2E436E',
    'focusRing': '#3574F0',
    'accent': '#E0A458',
    'success': '#5FAD56',
    'warning': '#E8A93B',
    'danger': '#F75464',
    'info': '#56A8F5',
    'editorBg': '#1E1F22',
    'editorLineHighlight': '#26282E',
    'editorGutter': '#8C9096'
} as const;

/** Darcula-like variant: warmer greys, classic JetBrains feel. */
export const DARCULA_TOKENS = {
    ...DARK_TOKENS,
    bg: '#2B2B2B',
    surface: '#313335',
    panel: '#3C3F41',
    toolbar: '#3C3F41',
    border: '#323232',
    text: '#BBBBBB',
    textMuted: '#8C8C8C',
    primary: '#4A88C7',
    primaryHover: '#5C9BD6',
    selection: '#2F65CA',
    editorBg: '#2B2B2B',
    editorLineHighlight: '#323232',
    editorGutter: '#606366'
} as const;
