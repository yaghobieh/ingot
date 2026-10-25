/* Generated from assets/brand/palette.json — keep in sync. */
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
    'panel': '#EEF0F4',
    'toolbar': '#F2F3F6',
    'border': '#DCDFE6',
    'text': '#1F2329',
    'textMuted': '#5E6673',
    'primary': '#3B6FD9',
    'primaryHover': '#2F5DBF',
    'primaryText': '#FFFFFF',
    'selection': '#DCE6FA',
    'focusRing': '#8FB0F0',
    'accent': '#C9822E',
    'success': '#2F8F5B',
    'warning': '#B7791F',
    'danger': '#C9423D',
    'info': '#2F7FB8',
    'editorBg': '#FFFFFF',
    'editorLineHighlight': '#F3F5F9',
    'editorGutter': '#9AA0AB'
} as const;

export const DARK_TOKENS = {
    'bg': '#1C1E24',
    'surface': '#23262E',
    'panel': '#2A2D36',
    'toolbar': '#202229',
    'border': '#3A3E49',
    'text': '#DFE1E5',
    'textMuted': '#9AA0AB',
    'primary': '#5B8DEF',
    'primaryHover': '#7AA3F3',
    'primaryText': '#0F1420',
    'selection': '#2E3E5E',
    'focusRing': '#4E77C9',
    'accent': '#E0A458',
    'success': '#5FB884',
    'warning': '#D9A23B',
    'danger': '#E06C66',
    'info': '#5AA9DE',
    'editorBg': '#1E2027',
    'editorLineHighlight': '#262932',
    'editorGutter': '#5E6673'
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
