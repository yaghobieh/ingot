import { uiThemeFor } from '../settings/settings.utils';
import { MAX_THEME_BYTES, stripJsonc, type ImportedTheme } from './theme-import.utils';
import { FALLBACK_SWATCH, ICON_THEME_PATTERN, MAX_INCLUDE_DEPTH, VSIX_ROOT } from './theme-store.consts';
import type { GroupedThemes, PickerTheme, StoreInstalledTheme, StoreThemeExtension, ThemeContribution, ThemeSource, ThemeSwatch } from './theme-store.types';

type Json = Record<string, unknown>;
const isObject = (value: unknown): value is Json => !!value && typeof value === 'object' && !Array.isArray(value);
const str = (value: unknown): string => typeof value === 'string' ? value : '';
const num = (value: unknown): number => typeof value === 'number' && Number.isFinite(value) ? value : 0;

/** ~/.ingot/themes.json (or the legacy storage value) → the installed themes; anything malformed is dropped. */
export function parseUserThemes(value: unknown): StoreInstalledTheme[] {
    let list = value;
    if (typeof value === 'string') {
        try {
            list = JSON.parse(value);
        } catch {
            return [];
        }
    }
    return Array.isArray(list) ? list.filter((t): t is StoreInstalledTheme => isObject(t) && !!str(t.id) && !!str(t.label) && !!str(t.uiTheme) && isObject(t.json)) : [];
}

/** Open VSX search response → color theme extensions (icon-only theme packs are left out). */
export function parseStoreSearch(json: unknown): StoreThemeExtension[] {
    const list = isObject(json) && Array.isArray(json.extensions) ? json.extensions : [];
    return list.filter(isObject).flatMap(e => {
        const namespace = str(e.namespace);
        const name = str(e.name);
        const files = isObject(e.files) ? e.files : {};
        const downloadUrl = str(files.download);
        if (!namespace || !name || !downloadUrl) {
            return [];
        }
        const displayName = str(e.displayName) || name;
        const description = str(e.description);
        if (ICON_THEME_PATTERN.test(`${name} ${displayName}`)) {
            return [];
        }
        const rating = typeof e.averageRating === 'number' ? e.averageRating : undefined;
        return [{
            id: `${namespace}.${name}`, namespace, name, displayName, description, version: str(e.version), downloads: num(e.downloadCount),
            rating, reviewCount: num(e.reviewCount), iconUrl: str(files.icon) || undefined, downloadUrl
        }];
    });
}

/** Normalises a path relative to a folder inside the package (`./`, `../`). */
export function resolvePackagePath(fromFile: string, relative: string): string {
    const parts = fromFile.split('/').slice(0, -1);
    for (const part of relative.replace(/\\/g, '/').split('/')) {
        if (part === '..') {
            parts.pop();
        } else if (part && part !== '.') {
            parts.push(part);
        }
    }
    return parts.join('/');
}

/** `contributes.themes` of a manifest, with paths inside the .vsix. */
export function colorThemesFromManifest(manifest: unknown): ThemeContribution[] {
    const contributes = isObject(manifest) && isObject(manifest.contributes) ? manifest.contributes : {};
    const themes = Array.isArray(contributes.themes) ? contributes.themes : [];
    return themes.filter(isObject).flatMap(t => {
        const path = str(t.path);
        if (!path || !/\.jsonc?$/i.test(path)) {
            return [];
        }
        const ui = str(t.uiTheme);
        const uiTheme: ImportedTheme['uiTheme'] = ui === 'vs' || ui === 'hc-black' || ui === 'hc-light' ? ui : 'vs-dark';
        return [{ label: str(t.label) || str(t.id) || path, uiTheme, path: resolvePackagePath(`${VSIX_ROOT}package.json`, path) }];
    });
}

const parseJson = (text: string, path: string): Json => {
    if (text.length > MAX_THEME_BYTES) {
        throw new Error(`${path} is too large.`);
    }
    const json = JSON.parse(stripJsonc(text));
    if (!isObject(json)) {
        throw new Error(`${path} is not a color theme.`);
    }
    return json;
};

/** Reads a theme file and flattens `include` and a `tokenColors` file reference (both JSON only). */
export function loadThemeJson(path: string, read: (path: string) => string | undefined, depth = 0): Json {
    if (depth > MAX_INCLUDE_DEPTH) {
        throw new Error('Theme includes are nested too deeply.');
    }
    const text = read(path);
    if (text === undefined) {
        throw new Error(`${path} is missing from the package.`);
    }
    const own = parseJson(text, path);
    let base: Json = {};
    if (typeof own.include === 'string') {
        if (!/\.jsonc?$/i.test(own.include)) {
            throw new Error('Themes based on TextMate files are not supported.');
        }
        base = loadThemeJson(resolvePackagePath(path, own.include), read, depth + 1);
    }
    let tokenColors: unknown = own.tokenColors;
    if (typeof tokenColors === 'string') {
        if (!/\.jsonc?$/i.test(tokenColors)) {
            throw new Error('Themes based on TextMate files are not supported.');
        }
        tokenColors = loadThemeJson(resolvePackagePath(path, tokenColors), read, depth + 1).tokenColors;
    }
    const merged: Json = { ...base, ...own };
    delete merged.include;
    merged.colors = { ...(isObject(base.colors) ? base.colors : {}), ...(isObject(own.colors) ? own.colors : {}) };
    merged.tokenColors = [...(Array.isArray(base.tokenColors) ? base.tokenColors : []), ...(Array.isArray(tokenColors) ? tokenColors : [])];
    if (isObject(base.semanticTokenColors) || isObject(own.semanticTokenColors)) {
        merged.semanticTokenColors = { ...(isObject(base.semanticTokenColors) ? base.semanticTokenColors : {}), ...(isObject(own.semanticTokenColors) ? own.semanticTokenColors : {}) };
    }
    return merged;
}

const slug = (value: string): string => value.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '');

export const storeThemeId = (extensionId: string, label: string): string => `vsx-${slug(extensionId)}-${slug(label) || 'theme'}`;

/** Every color theme of a downloaded package, ready to register. Themes that cannot be read are skipped. */
export function themesFromPackage(manifest: unknown, read: (path: string) => string | undefined, source: ThemeSource): { themes: StoreInstalledTheme[]; skipped: string[] } {
    const themes: StoreInstalledTheme[] = [];
    const skipped: string[] = [];
    for (const contribution of colorThemesFromManifest(manifest)) {
        try {
            const json = loadThemeJson(contribution.path, read);
            const uiTheme = typeof json.type === 'string' ? uiThemeFor(json.type) : contribution.uiTheme;
            themes.push({ id: storeThemeId(source.extensionId, contribution.label), label: contribution.label, uiTheme, json, source });
        } catch {
            skipped.push(contribution.label);
        }
    }
    return { themes, skipped };
}

const COLOR = /^#[0-9a-f]{3,8}$/i;
const color = (value: unknown): string | undefined => typeof value === 'string' && COLOR.test(value) ? value : undefined;

/** A few representative colors of a theme for the preview strip. */
export function swatchOf(json: Json, uiTheme: string): ThemeSwatch {
    const fallback = uiTheme === 'vs' || uiTheme === 'hc-light' ? FALLBACK_SWATCH.light : FALLBACK_SWATCH.dark;
    const colors = isObject(json.colors) ? json.colors : {};
    const syntax: string[] = [];
    for (const rule of Array.isArray(json.tokenColors) ? json.tokenColors : []) {
        const fg = isObject(rule) && isObject(rule.settings) ? color(rule.settings.foreground) : undefined;
        if (fg && !syntax.includes(fg.toUpperCase())) {
            syntax.push(fg.toUpperCase());
        }
        if (syntax.length === 4) {
            break;
        }
    }
    return {
        background: color(colors['editor.background']) ?? fallback.background,
        foreground: color(colors['editor.foreground']) ?? color(colors.foreground) ?? fallback.foreground,
        accent: color(colors['focusBorder']) ?? color(colors['button.background']) ?? color(colors['activityBarBadge.background']) ?? fallback.accent,
        syntax
    };
}

export const isLightTheme = (uiTheme: string): boolean => uiTheme === 'vs' || uiTheme === 'hc-light' || uiTheme === 'light';

/** Installed themes for the picker: filtered by the query, grouped Light / Dark, sorted by name. */
export function groupThemes(themes: readonly PickerTheme[], query: string): GroupedThemes {
    const q = query.trim().toLowerCase();
    const matches = themes.filter(t => !q || t.label.toLowerCase().includes(q) || (t.description ?? '').toLowerCase().includes(q));
    const sorted = [...matches].sort((a, b) => a.label.localeCompare(b.label));
    return { light: sorted.filter(t => isLightTheme(t.uiTheme)), dark: sorted.filter(t => !isLightTheme(t.uiTheme)) };
}

/** 6551178 → 6.6M, 12400 → 12K. */
export function formatCount(n: number): string {
    if (n >= 1_000_000) {
        return `${(n / 1_000_000).toFixed(n >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
    }
    if (n >= 1_000) {
        return `${(n / 1_000).toFixed(n >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`;
    }
    return String(n);
}

/** Search URL for color themes, most downloaded first. */
export const storeSearchUrl = (api: string, query: string, size: number): string =>
    `${api}/-/search?category=Themes&sortBy=downloadCount&sortOrder=desc&size=${size}&includeAllVersions=false${query.trim() ? `&query=${encodeURIComponent(query.trim())}` : ''}`;
