/** `pub.name@1.2.3` → `pub.name`. */
export const unversionedId = (id: string): string => id.split('@')[0];

export const formatDownloads = (count?: number): string => {
    if (!count || count < 0) {
        return '';
    }
    if (count >= 1_000_000) {
        return `${(count / 1_000_000).toFixed(count >= 10_000_000 ? 0 : 1).replace(/\.0$/, '')}M`;
    }
    if (count >= 1_000) {
        return `${(count / 1_000).toFixed(count >= 10_000 ? 0 : 1).replace(/\.0$/, '')}K`;
    }
    return String(count);
};

export interface PluginManifest {
    readonly name?: unknown;
    readonly publisher?: unknown;
    readonly version?: unknown;
    readonly engines?: unknown;
    readonly contributes?: { readonly themes?: unknown[]; readonly iconThemes?: unknown[] };
}

/** Validates a plugin folder's package.json before installing it from disk (developer flow). */
export const validatePluginManifest = (text: string): { id: string; folder: string } => {
    let manifest: PluginManifest;
    try {
        manifest = JSON.parse(text) as PluginManifest;
    } catch {
        throw new Error('package.json is not valid JSON.');
    }
    const { name, publisher, version, engines } = manifest;
    if (typeof name !== 'string' || typeof publisher !== 'string' || typeof version !== 'string') {
        throw new Error('package.json needs "name", "publisher" and "version".');
    }
    const engineMap = engines as Record<string, unknown> | undefined;
    if (!engineMap || (typeof engineMap.vscode !== 'string' && typeof engineMap.theiaPlugin !== 'string')) {
        throw new Error('package.json needs "engines.vscode" (VS Code extension) or "engines.theiaPlugin".');
    }
    const safe = (s: string) => /^[a-zA-Z0-9][\w.-]*$/.test(s);
    if (!safe(name) || !safe(publisher) || !safe(version)) {
        throw new Error('Plugin name, publisher and version may only contain letters, digits, ".", "_" and "-".');
    }
    return { id: `${publisher.toLowerCase()}.${name.toLowerCase()}`, folder: `${publisher.toLowerCase()}.${name.toLowerCase()}-${version}` };
};

export interface ContributionSummary { readonly themes: number; readonly iconThemes: number }

export const pluginKinds = (summary: ContributionSummary | undefined): string[] => [
    ...(summary?.themes ? ['Theme'] : []),
    ...(summary?.iconThemes ? ['Icon Theme'] : [])
];
