import type { GuidePlatform } from '../debug/debug.types';

/** IDEA-313: languages Ingot supports out of the box (Settings › Languages). */
export type LanguageId =
    | 'php' | 'cobol' | 'javascript' | 'java' | 'cpp' | 'python' | 'go' | 'rust' | 'csharp' | 'ruby' | 'kotlin' | 'swift' | 'dart'
    | 'sql' | 'html' | 'shell' | 'yaml' | 'json' | 'markdown';

/** What a language can do in the IDE; one column of the Languages page. */
export type LanguageFeature = 'grammar' | 'completion' | 'hover' | 'definition' | 'diagnostics' | 'formatting' | 'debug' | 'tests' | 'run' | 'codeTools' | 'index';

/** Tools Ingot looks for on this machine (compilers, runtimes, language servers that come with a toolchain). */
export type ToolchainId =
    | 'node' | 'php' | 'jdk' | 'jre' | 'maven' | 'gradle' | 'clangd' | 'cc' | 'cmake' | 'lldbDap' | 'python' | 'go' | 'cargo' | 'dotnet' | 'ruby'
    | 'kotlinc' | 'swift' | 'dart' | 'sqlite3' | 'cobc' | 'bash' | 'shellcheck' | 'shfmt';

/** An Open VSX extension Ingot ships (or installs on first use), with its licence. */
export interface LanguageExtension {
    readonly id: string;
    readonly label: string;
    /** SPDX expression of the licence the extension is redistributed under. */
    readonly licence: string;
    readonly url: string;
    /** Not bundled: installed from Open VSX the first time it is needed. */
    readonly onDemand?: boolean;
}

/** How one feature of a language is provided. */
export interface FeatureSupport {
    /** The extension that provides it; none for features Ingot itself provides (tests, run, index). */
    readonly extension?: string;
    /** Tools that must be installed for it to work. */
    readonly toolchains?: readonly ToolchainId[];
    /** Short explanation shown next to the feature. */
    readonly note?: string;
}

/** `na`: the feature makes no sense for the language (debugging YAML). Missing key: not supported yet. */
export type FeatureEntry = FeatureSupport | 'na';

/** Runs the open file: `${file}`, `${fileDirname}`, `${fileBasenameNoExtension}` and `${tmpdir}` are replaced. */
export interface RunRecipe {
    readonly toolchains: readonly ToolchainId[];
    /** Command line per file extension (`.ts`); `*` for every other file of the language. */
    readonly commands: Readonly<Record<string, string>>;
}

/** Builds the project when `marker` is at the project root. */
export interface BuildRecipe {
    readonly marker: string;
    readonly command: string;
    readonly toolchains: readonly ToolchainId[];
}

export interface LanguageSpec {
    readonly id: LanguageId;
    readonly label: string;
    /** Monaco / VS Code language ids of its files. */
    readonly monacoIds: readonly string[];
    /** Lower-case extensions with the dot. */
    readonly fileExtensions: readonly string[];
    readonly fileNames?: readonly string[];
    readonly features: Readonly<Partial<Record<LanguageFeature, FeatureEntry>>>;
    readonly run?: RunRecipe;
    readonly build?: readonly BuildRecipe[];
    /** Tools prompted for when a file of the language opens; usually what the language server and Run need. */
    readonly prompt?: readonly ToolchainId[];
}

export interface ToolchainProbe {
    readonly command: string;
    readonly args: readonly string[];
}

export interface ToolchainSpec {
    readonly id: ToolchainId;
    readonly label: string;
    /** Tried in order; the first one that exits with status 0 wins. */
    readonly probes: readonly ToolchainProbe[];
    /** Group 1 is the version; the first `x.y[.z]` in the output otherwise. */
    readonly versionPattern?: RegExp;
    readonly minVersion?: string;
    /** Why Ingot needs it, in one sentence. */
    readonly why: string;
    readonly install: Readonly<Record<GuidePlatform, string>>;
    readonly url: string;
}

export interface ToolchainStatus {
    readonly id: ToolchainId;
    readonly found: boolean;
    readonly version?: string;
    /** Found, but older than `minVersion`. */
    readonly tooOld?: boolean;
    /** Provided by a bundled extension instead of this machine (the Java runtime inside redhat.java). */
    readonly bundled?: boolean;
    /** Where it was found (binary or home folder). */
    readonly path?: string;
}

/** A default Ingot gives an extension setting. */
export type ExtensionSettingValue = boolean | string;

export type FeatureState = 'ready' | 'needs-toolchain' | 'missing-extension' | 'on-demand' | 'unsupported' | 'na';

export interface FeatureReport {
    readonly feature: LanguageFeature;
    readonly state: FeatureState;
    readonly extension?: string;
    readonly missing: readonly ToolchainId[];
    readonly note?: string;
}

/** `ready`: everything supported works; `needs-toolchain`: install something; `partial`: some features are not supported. */
export type LanguageLevel = 'ready' | 'needs-toolchain' | 'partial';

export interface LanguageReport {
    readonly id: LanguageId;
    readonly label: string;
    readonly level: LanguageLevel;
    readonly features: readonly FeatureReport[];
    readonly missingToolchains: readonly ToolchainId[];
    readonly extensions: readonly (LanguageExtension & { readonly installed: boolean })[];
}

/** Test seam: forces a toolchain to look missing or present, whatever is installed. */
export type ToolchainOverride = 'missing' | 'found';

export const ToolchainService = Symbol('IngotToolchainService');

/** Backend: finds compilers, runtimes and toolchains on this machine. */
export interface ToolchainService {
    /** All known toolchains, or the given ones; cached until `refresh`. */
    check(ids?: readonly ToolchainId[]): Promise<ToolchainStatus[]>;
    /** Forgets the cache (after the user installed something). */
    refresh(): Promise<void>;
    /** Ids (`publisher.name`, lower case) of the deployed extensions. */
    installedExtensions(): Promise<string[]>;
    /** Where Run puts compiled binaries, and the PATH (with the extra tool folders) it runs with. */
    runContext(): Promise<RunContext>;
}

export interface RunContext {
    readonly tmpdir: string;
    readonly path: string;
}
