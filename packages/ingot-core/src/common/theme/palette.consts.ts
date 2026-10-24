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
    'panel': '#EBECF0',
    'toolbar': '#ECEDF1',
    'border': '#E3E4E8',
    'text': '#1E1F22',
    'textMuted': '#6C707E',
    'primary': '#3B6FD9',
    'primaryHover': '#2F5DBF',
    'primaryText': '#FFFFFF',
    'selection': '#D5E1FF',
    'focusRing': '#8FB0F0',
    'accent': '#C9822E',
    'success': '#208A3C',
    'warning': '#B7791F',
    'danger': '#DB3B4B',
    'info': '#2F7FB8',
    'editorBg': '#FFFFFF',
    'editorLineHighlight': '#F5F8FE',
    'editorGutter': '#AEB3C2'
} as const;

export const DARK_TOKENS = {
    'bg': '#222327',
    'surface': '#2B2D30',
    'panel': '#2B2D30',
    'toolbar': '#191A1C',
    'border': '#2E3034',
    'text': '#DFE1E5',
    'textMuted': '#868A91',
    'primary': '#548AF7',
    'primaryHover': '#7AA3F3',
    'primaryText': '#FFFFFF',
    'selection': '#2E436E',
    'focusRing': '#3574F0',
    'accent': '#E0A458',
    'success': '#5FB865',
    'warning': '#D9A23B',
    'danger': '#E55765',
    'info': '#5AA9DE',
    'editorBg': '#1E1F22',
    'editorLineHighlight': '#26282E',
    'editorGutter': '#4B5059'
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
