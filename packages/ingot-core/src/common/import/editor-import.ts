import type { DetectedExtension } from './editor-import.types';

/** Extension folders of other editors, relative to the home folder. */
export const EXTENSION_DIRS: readonly string[] = ['.vscode/extensions', '.cursor/extensions', '.vscode-oss/extensions', '.windsurf/extensions'];
/** Matching user-settings folders (macOS, then Linux/Windows-style), relative to the home folder; same order as EXTENSION_DIRS. */
const APP_FOLDERS: readonly string[] = ['Code', 'Cursor', 'VSCodium', 'Windsurf'];
export const userSettingsDirs = (platform: string, index: number): string[] => {
    const app = APP_FOLDERS[index];
    if (!app) {
        return [];
    }
    return platform === 'darwin' ? [`Library/Application Support/${app}/User`]
        : platform === 'win32' ? [`AppData/Roaming/${app}/User`] : [`.config/${app}/User`];
};

/** Persisted "the first-run import prompt was answered". */
export const IMPORT_PROMPTED_KEY = 'ingot.import.prompted';
export const IMPORT_COMMAND = { id: 'ingot.import.fromEditor', label: 'Import from Another Editor…', category: 'Ingot' } as const;
export const OPENVSX_URL_ENV = 'INGOT_OPENVSX_URL';
export const OPENVSX_URL = 'https://open-vsx.org';

/** Entries of an extensions folder's extensions.json. */
interface ManifestEntry {
    readonly identifier?: { readonly id?: string };
    readonly version?: string;
    readonly relativeLocation?: string;
    readonly location?: { readonly path?: string; readonly fsPath?: string } | string;
}

/** Folder name → extension (`publisher.name-1.2.3`, optionally with a `-darwin-arm64` style target). */
export const parseExtensionFolder = (folder: string): { id: string; version: string } | undefined => {
    const match = /^([a-z0-9][\w-]*\.[a-z0-9][\w.-]*?)-(\d+\.\d+\.\d+[\w.+-]*?)(?:-(?:darwin|linux|win32|alpine|web)-[a-z0-9]+)?$/i.exec(folder);
    return match ? { id: match[1].toLowerCase(), version: match[2] } : undefined;
};

/** extensions.json → id, version, folder name (relative) or absolute path. */
export const parseExtensionsManifest = (json: string): { id: string; version: string; location: string }[] => {
    let entries: unknown;
    try {
        entries = JSON.parse(json);
    } catch {
        return [];
    }
    if (!Array.isArray(entries)) {
        return [];
    }
    return (entries as ManifestEntry[]).flatMap(entry => {
        const id = entry.identifier?.id?.toLowerCase();
        const location = entry.relativeLocation ?? (typeof entry.location === 'string' ? entry.location : entry.location?.fsPath ?? entry.location?.path);
        return id && location ? [{ id, version: entry.version ?? '0.0.0', location }] : [];
    });
};

const versionParts = (v: string): number[] => v.split(/[.+-]/).map(n => Number.parseInt(n, 10)).map(n => (Number.isFinite(n) ? n : 0));
export const compareVersions = (a: string, b: string): number => {
    const x = versionParts(a);
    const y = versionParts(b);
    for (let i = 0; i < Math.max(x.length, y.length); i++) {
        const d = (x[i] ?? 0) - (y[i] ?? 0);
        if (d) {
            return d;
        }
    }
    return 0;
};

/** One entry per id, the highest version wins. */
export const latestPerId = <T extends Pick<DetectedExtension, 'id' | 'version'>>(items: readonly T[]): T[] => {
    const best = new Map<string, T>();
    for (const item of items) {
        const current = best.get(item.id);
        if (!current || compareVersions(item.version, current.version) > 0) {
            best.set(item.id, item);
        }
    }
    return [...best.values()].sort((a, b) => a.id.localeCompare(b.id));
};

/** Proposed APIs Theia does not implement: remote authority resolvers (Remote - SSH, Dev Containers, WSL) fail to load. */
const UNSUPPORTED_API_PROPOSALS: readonly string[] = ['resolvers'];
export const usesUnsupportedApi = (pkg: { readonly enabledApiProposals?: unknown }): boolean =>
    Array.isArray(pkg.enabledApiProposals) && pkg.enabledApiProposals.some(p => UNSUPPORTED_API_PROPOSALS.includes(p));

/** Theia scans this folder of the config dir on every start; imported local-only extensions are copied here. */
export const DEPLOYED_PLUGINS_DIR = 'deployedPlugins';
/** Where a deployed plugin keeps its manifest: unpacked folders at the root, unpacked .vsix files under `extension/`. */
export const PLUGIN_MANIFEST_PATHS: readonly string[] = ['package.json', 'extension/package.json'];

/** `publisher.name` → Open VSX API path. */
export const openVsxPath = (id: string): string | undefined => {
    const dot = id.indexOf('.');
    return dot > 0 && dot < id.length - 1 ? `/api/${encodeURIComponent(id.slice(0, dot))}/${encodeURIComponent(id.slice(dot + 1))}` : undefined;
};

/** Strips // and /* *\/ comments and trailing commas from JSONC (settings.json, keybindings.json). */
export const parseJsonc = (text: string): unknown => {
    let out = '';
    let inString = false;
    for (let i = 0; i < text.length; i++) {
        const c = text[i];
        if (inString) {
            out += c;
            if (c === '\\') {
                out += text[++i] ?? '';
            } else if (c === '"') {
                inString = false;
            }
        } else if (c === '"') {
            inString = true;
            out += c;
        } else if (c === '/' && text[i + 1] === '/') {
            while (i < text.length && text[i] !== '\n') {
                i++;
            }
            out += '\n';
        } else if (c === '/' && text[i + 1] === '*') {
            i += 2;
            while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
                i++;
            }
            i++;
        } else {
            out += c;
        }
    }
    return JSON.parse(out.replace(/,(\s*[}\]])/g, '$1'));
};

/** Adds imported settings that Ingot does not set yet; never overwrites. */
export const mergeSettings = (ingot: Record<string, unknown>, imported: Record<string, unknown>): { merged: Record<string, unknown>; added: number; skipped: number } => {
    const merged = { ...ingot };
    let added = 0;
    let skipped = 0;
    for (const [key, value] of Object.entries(imported)) {
        if (key in merged) {
            skipped++;
        } else {
            merged[key] = value;
            added++;
        }
    }
    return { merged, added, skipped };
};

interface Keybinding { readonly key?: string; readonly command?: string; readonly when?: string }
/** Appends imported keybindings that are not already there (same key + command + when). */
export const mergeKeybindings = (ingot: readonly Keybinding[], imported: readonly Keybinding[]): { merged: Keybinding[]; added: number; skipped: number } => {
    const sig = (k: Keybinding) => `${k.key ?? ''}\u0000${k.command ?? ''}\u0000${k.when ?? ''}`;
    const seen = new Set(ingot.map(sig));
    const merged = [...ingot];
    let added = 0;
    let skipped = 0;
    for (const binding of imported) {
        if (!binding.key || !binding.command || seen.has(sig(binding))) {
            skipped++;
            continue;
        }
        seen.add(sig(binding));
        merged.push(binding);
        added++;
    }
    return { merged, added, skipped };
};
