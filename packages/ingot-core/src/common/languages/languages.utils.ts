import type { GuidePlatform } from '../debug/debug.types';
import { LANGUAGE_EXTENSIONS, LANGUAGE_FEATURES, LANGUAGES, RUN_DELTA_ANCHOR_CHARS, TOOLCHAINS } from './languages.consts';
import type {
    BuildRecipe, FeatureEntry, FeatureReport, LanguageExtension, LanguageFeature, LanguageId, LanguageLevel, LanguageReport, LanguageSpec, ToolchainId,
    ToolchainOverride, ToolchainSpec, ToolchainStatus
} from './languages.types';

const GENERIC_VERSION = /(\d+\.\d+(?:\.\d+)?)/;
const GLOB_STAR = '*';

export const languageById = (id: LanguageId): LanguageSpec | undefined => LANGUAGES.find(l => l.id === id);

export const extensionInfo = (id: string): LanguageExtension | undefined => LANGUAGE_EXTENSIONS.find(e => e.id.toLowerCase() === id.toLowerCase());

const extensionOf = (path: string): string => {
    const name = baseName(path).toLowerCase();
    const dot = name.lastIndexOf('.');
    return dot > 0 ? name.slice(dot) : '';
};

export const baseName = (path: string): string => path.split(/[\\/]/).pop() ?? path;

/** The language of a file, by name (`Cargo.toml`) or extension. */
export const languageForFile = (path: string): LanguageSpec | undefined => {
    const name = baseName(path);
    const extension = extensionOf(path);
    return LANGUAGES.find(l => l.fileNames?.includes(name)) ?? (extension ? LANGUAGES.find(l => l.fileExtensions.includes(extension)) : undefined);
};

/** The language of a Monaco / VS Code language id (`typescriptreact` → JavaScript / TypeScript). */
export const languageForMonacoId = (monacoId: string): LanguageSpec | undefined => LANGUAGES.find(l => l.monacoIds.includes(monacoId));

/** The version in a tool's `--version` output. */
export const parseToolVersion = (spec: Pick<ToolchainSpec, 'versionPattern'>, output: string): string | undefined =>
    (spec.versionPattern?.exec(output) ?? GENERIC_VERSION.exec(output))?.[1];

/** `a >= b` for dotted versions (`3.0`, `21.0.1`, `2.6.10`); non-numeric parts count as 0. */
export const versionAtLeast = (version: string, minimum: string): boolean => {
    const parts = (v: string): number[] => v.split(/[.+_-]/).map(p => Number.parseInt(p, 10)).map(n => Number.isFinite(n) ? n : 0);
    const a = parts(version);
    const b = parts(minimum);
    for (let i = 0; i < Math.max(a.length, b.length); i++) {
        const diff = (a[i] ?? 0) - (b[i] ?? 0);
        if (diff !== 0) {
            return diff > 0;
        }
    }
    return true;
};

/** A probe's result as a status: found when it exited 0, too old below `minVersion`. */
export const toolchainStatusFrom = (id: ToolchainId, ok: boolean, output: string, path?: string): ToolchainStatus => {
    if (!ok) {
        return { id, found: false };
    }
    const spec = TOOLCHAINS[id];
    const version = parseToolVersion(spec, output);
    const tooOld = !!(version && spec.minVersion && !versionAtLeast(version, spec.minVersion));
    return { id, found: true, ...(version ? { version } : {}), ...(tooOld ? { tooOld } : {}), ...(path ? { path } : {}) };
};

/** Usable: found and new enough. */
export const isUsable = (status: ToolchainStatus | undefined): boolean => !!status?.found && !status.tooOld;

/** Overrides from the test seam file: unknown ids and values are dropped. */
export const parseOverrides = (raw: string | undefined): Partial<Record<ToolchainId, ToolchainOverride>> => {
    if (!raw) {
        return {};
    }
    try {
        const json = JSON.parse(raw) as Record<string, unknown>;
        return Object.fromEntries(Object.entries(json).filter(([id, value]) => id in TOOLCHAINS && (value === 'missing' || value === 'found'))) as Partial<Record<ToolchainId, ToolchainOverride>>;
    } catch {
        return {};
    }
};

export const applyOverride = (status: ToolchainStatus, override: ToolchainOverride | undefined): ToolchainStatus => {
    if (override === 'missing') {
        return { id: status.id, found: false };
    }
    if (override === 'found' && !status.found) {
        return { id: status.id, found: true };
    }
    return status;
};

const isSupport = (entry: FeatureEntry | undefined): entry is Exclude<FeatureEntry, 'na'> => !!entry && entry !== 'na';

/** How one feature of a language stands with the installed extensions and toolchains. */
export const featureReport = (
    spec: LanguageSpec, feature: LanguageFeature, installed: ReadonlySet<string>, toolchains: ReadonlyMap<ToolchainId, ToolchainStatus>
): FeatureReport => {
    if (feature === 'index') {
        return { feature, state: 'ready', missing: [], note: 'Every text file is indexed.' };
    }
    if (feature === 'codeTools') {
        const definition = featureReport(spec, 'definition', installed, toolchains);
        return { ...definition, feature, note: 'Go to definition, references, rename and diagnostics through the language server.' };
    }
    const entry = spec.features[feature];
    if (entry === 'na') {
        return { feature, state: 'na', missing: [] };
    }
    if (!isSupport(entry)) {
        return { feature, state: 'unsupported', missing: [] };
    }
    const missing = (entry.toolchains ?? []).filter(id => !isUsable(toolchains.get(id)));
    const base = { feature, missing, ...(entry.extension ? { extension: entry.extension } : {}), ...(entry.note ? { note: entry.note } : {}) };
    const info = entry.extension ? extensionInfo(entry.extension) : undefined;
    if (entry.extension && !installed.has(entry.extension.toLowerCase())) {
        return { ...base, state: info?.onDemand ? 'on-demand' : 'missing-extension' };
    }
    return { ...base, state: missing.length ? 'needs-toolchain' : 'ready' };
};

const levelOf = (features: readonly FeatureReport[]): LanguageLevel => {
    if (features.some(f => f.state === 'needs-toolchain' || f.state === 'missing-extension')) {
        return 'needs-toolchain';
    }
    return features.some(f => f.state === 'unsupported') ? 'partial' : 'ready';
};

/** The extensions a language uses (bundled or on demand), in feature order, without duplicates. */
export const languageExtensions = (spec: LanguageSpec): LanguageExtension[] => {
    const ids = new Set<string>();
    for (const feature of LANGUAGE_FEATURES) {
        const entry = spec.features[feature];
        if (isSupport(entry) && entry.extension) {
            ids.add(entry.extension);
        }
    }
    return [...ids].map(id => extensionInfo(id)).filter((e): e is LanguageExtension => !!e);
};

/** One row of the Languages page. `installed` holds lower-case extension ids. */
export const languageReport = (spec: LanguageSpec, installed: ReadonlySet<string>, toolchains: ReadonlyMap<ToolchainId, ToolchainStatus>): LanguageReport => {
    const features = LANGUAGE_FEATURES.map(feature => featureReport(spec, feature, installed, toolchains));
    const missingToolchains = [...new Set(features.flatMap(f => f.missing))];
    return {
        id: spec.id, label: spec.label, level: levelOf(features), features, missingToolchains,
        extensions: languageExtensions(spec).map(e => ({ ...e, installed: installed.has(e.id.toLowerCase()) }))
    };
};

export const languageReports = (installed: ReadonlySet<string>, toolchains: readonly ToolchainStatus[]): LanguageReport[] => {
    const byId = new Map(toolchains.map(t => [t.id, t] as const));
    return LANGUAGES.map(spec => languageReport(spec, installed, byId));
};

/** The toolchains to offer when a file of the language opens: the prompt list that is not usable and not dismissed. */
export const toolchainsToPrompt = (spec: LanguageSpec, toolchains: ReadonlyMap<ToolchainId, ToolchainStatus>, dismissed: readonly string[]): ToolchainId[] =>
    (spec.prompt ?? []).filter(id => !isUsable(toolchains.get(id)) && !dismissed.includes(id));

export const installCommand = (id: ToolchainId, platform: GuidePlatform): string => TOOLCHAINS[id].install[platform];

/** One friendly sentence for a missing (or too old) toolchain. */
export const missingToolchainMessage = (language: string, id: ToolchainId, status: ToolchainStatus | undefined, platform: GuidePlatform): string => {
    const spec = TOOLCHAINS[id];
    const problem = status?.found && status.tooOld
        ? `${language} needs ${spec.label} ${spec.minVersion} or newer (found ${status.version}).`
        : `${spec.label} is not installed.`;
    return `${problem} ${spec.why} Install it with: ${installCommand(id, platform)}`;
};

export interface FileVariables {
    readonly file: string;
    readonly tmpdir: string;
    /** The `java` launcher; `java` from PATH when absent. */
    readonly java?: string;
}

const DEFAULT_JAVA = 'java';

/** The quoted `java` launcher of a Java home (`<home>/bin/java`). */
export const javaLauncher = (home: string | undefined, windows: boolean): string | undefined =>
    home ? `"${home}${windows ? '\\bin\\java.exe' : '/bin/java'}"` : undefined;

const dirName = (path: string): string => {
    const index = Math.max(path.lastIndexOf('/'), path.lastIndexOf('\\'));
    return index > 0 ? path.slice(0, index) : path;
};

/** `${file}`-style variables of a run command. */
export const substituteFileVariables = (template: string, vars: FileVariables): string => {
    const name = baseName(vars.file);
    const dot = name.lastIndexOf('.');
    const values: Record<string, string> = {
        file: vars.file,
        fileDirname: dirName(vars.file),
        fileBasenameNoExtension: dot > 0 ? name.slice(0, dot) : name,
        tmpdir: vars.tmpdir,
        java: vars.java ?? DEFAULT_JAVA
    };
    return template.replace(/\$\{(\w+)\}/g, (all, key: string) => values[key] ?? all);
};

/** The command that runs a file, with the toolchains it needs; undefined when Ingot cannot run that file type. */
export const runCommandFor = (
    path: string, tmpdir: string, java?: string
): { language: LanguageSpec; command: string; toolchains: readonly ToolchainId[] } | undefined => {
    const language = languageForFile(path);
    if (!language?.run) {
        return undefined;
    }
    const template = language.run.commands[extensionOf(path)] ?? language.run.commands[GLOB_STAR];
    return template ? { language, command: substituteFileVariables(template, { file: path, tmpdir, java }), toolchains: language.run.toolchains } : undefined;
};

/** A bundled-Java status for a toolchain the machine lacks (the JDK inside redhat.java). */
export const bundledJavaStatus = (id: ToolchainId, home: string, releaseText: string): ToolchainStatus => {
    const version = /JAVA_VERSION="([^"]+)"/.exec(releaseText)?.[1];
    return { id, found: true, bundled: true, path: home, ...(version ? { version } : {}) };
};

const matchesMarker = (marker: string, files: readonly string[]): boolean =>
    marker.startsWith(GLOB_STAR) ? files.some(f => f.endsWith(marker.slice(GLOB_STAR.length))) : files.includes(marker);

/** The project's build: the first recipe whose marker file is at the root (languages in registry order). */
export const buildRecipeFor = (rootFiles: readonly string[], packageJson?: string): (BuildRecipe & { language: LanguageId }) | undefined => {
    for (const language of LANGUAGES) {
        for (const recipe of language.build ?? []) {
            if (!matchesMarker(recipe.marker, rootFiles)) {
                continue;
            }
            if (recipe.marker === 'package.json' && !hasBuildScript(packageJson)) {
                continue;
            }
            return { ...recipe, language: language.id };
        }
    }
    return undefined;
};

const hasBuildScript = (packageJson: string | undefined): boolean => {
    try {
        return typeof (JSON.parse(packageJson ?? '') as { scripts?: Record<string, unknown> }).scripts?.build === 'string';
    } catch {
        return false;
    }
};

/** The new part of a process transcript; when the kept tail scrolled, it continues where it overlaps what was shown. */
export const runTranscriptDelta = (shown: string, next: string): string => {
    if (next.startsWith(shown)) {
        return next.slice(shown.length);
    }
    const firstLine = next.indexOf('\n') + 1;
    const head = next.slice(0, Math.min(RUN_DELTA_ANCHOR_CHARS, firstLine || next.length));
    for (let at = shown.indexOf(head); head && at >= 0; at = shown.indexOf(head, at + 1)) {
        const overlap = shown.slice(at);
        if (next.startsWith(overlap)) {
            return next.slice(overlap.length);
        }
    }
    return next;
};
