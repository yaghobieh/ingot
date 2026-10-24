import { themeIdFromLabel, uiThemeFor } from '../settings/settings.utils';

export interface ImportedTheme {
    readonly id: string;
    readonly label: string;
    readonly uiTheme: 'vs' | 'vs-dark' | 'hc-black' | 'hc-light';
    readonly json: Record<string, unknown>;
}

export const USER_THEMES_STORAGE_KEY = 'ingot.userThemes';
export const MAX_THEME_BYTES = 2_000_000;

/** Strips // and /* *\/ comments and trailing commas (VS Code themes are JSONC), leaving strings intact. */
export const stripJsonc = (text: string): string => {
    let out = '';
    let inString = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        const next = text[i + 1];
        if (inString) {
            out += c;
            if (c === '\\') {
                out += next ?? '';
                i++;
            } else if (c === '"') {
                inString = false;
            }
        } else if (c === '"') {
            inString = true;
            out += c;
        } else if (c === '/' && next === '/') {
            while (i < text.length && text[i] !== '\n') {
                i++;
            }
            out += '\n';
        } else if (c === '/' && next === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
                i++;
            }
            i++;
        } else {
            out += c;
        }
    }
    return out.replace(/,(\s*[}\]])/g, '$1');
};

/** Validates a VS Code color theme file and turns it into a theme Ingot can register. */
export const parseVsCodeTheme = (text: string, fileName: string): ImportedTheme => {
    if (text.length > MAX_THEME_BYTES) {
        throw new Error('Theme file is too large.');
    }
    let json: unknown;
    try {
        json = JSON.parse(stripJsonc(text));
    } catch {
        throw new Error('Not a valid JSON color theme.');
    }
    if (!json || typeof json !== 'object' || Array.isArray(json)) {
        throw new Error('Not a valid JSON color theme.');
    }
    const theme = json as Record<string, unknown>;
    const hasColors = typeof theme.colors === 'object' && theme.colors !== null;
    const hasTokens = Array.isArray(theme.tokenColors) || typeof theme.tokenColors === 'string' || typeof theme.semanticTokenColors === 'object';
    if (!hasColors && !hasTokens) {
        throw new Error('The file has no "colors" or "tokenColors"; it is not a VS Code color theme.');
    }
    if (typeof theme.include === 'string' || typeof theme.tokenColors === 'string') {
        throw new Error('Themes that include other files are not supported yet; install the theme as a plugin instead.');
    }
    const label = (typeof theme.name === 'string' && theme.name.trim()) || fileName.replace(/(-color-theme)?\.jsonc?$/i, '');
    return { id: themeIdFromLabel(label), label, uiTheme: uiThemeFor(theme.type), json: theme };
};

/** Replaces a theme with the same id, keeping the rest. */
export const upsertTheme = (themes: readonly ImportedTheme[], theme: ImportedTheme): ImportedTheme[] =>
    [...themes.filter(t => t.id !== theme.id), theme];
