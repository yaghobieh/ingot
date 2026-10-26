/** Language runtimes the debugger can check for and guide the user to install (IDEA-138). */
export type DebugRuntimeKind = 'java' | 'php' | 'node' | 'python';

/** A launch.json configuration (the VS Code-compatible schema Theia and the Open VSX debug adapters use). */
export interface LaunchConfiguration {
    readonly type: string;
    readonly request: 'launch' | 'attach';
    readonly name: string;
    readonly [key: string]: unknown;
}

/** What the debugger knows about the open project when it suggests configurations. */
export interface ProjectFacts {
    /** File and folder names at the project root. */
    readonly rootFiles: readonly string[];
    /** Lower-case file extensions found in the project (`.java`, `.php`, ...), shallow scan. */
    readonly extensions: readonly string[];
    /** Root `package.json` text, if any. */
    readonly packageJson?: string;
}

/** A configuration the IDE suggests for the project, with the runtime it needs. */
export interface DetectedConfiguration {
    readonly configuration: LaunchConfiguration;
    readonly runtime: DebugRuntimeKind;
    readonly detail: string;
}

/** A starter configuration in the Run/Debug Configurations editor. */
export interface DebugTemplate {
    readonly id: string;
    readonly label: string;
    readonly runtime: DebugRuntimeKind;
    readonly configuration: LaunchConfiguration;
}

export interface RuntimeStatus {
    readonly kind: DebugRuntimeKind;
    readonly found: boolean;
    readonly version?: string;
    /** PHP only: the Xdebug extension is loaded. */
    readonly xdebug?: boolean;
}

/** `bundled` does not block: Ingot ships that runtime (Java). */
export type RuntimeProblem = 'runtime' | 'xdebug' | 'bundled';

export type GuidePlatform = 'mac' | 'linux' | 'windows';

/** How the IDE helps install a missing runtime. */
export interface RuntimeGuide {
    readonly title: string;
    readonly why: string;
    readonly install: Readonly<Record<GuidePlatform, string>>;
    readonly url: string;
}

/** Fields the configurations editor shows as inputs, per debug type. */
export interface ConfigurationField {
    readonly key: string;
    readonly label: string;
    readonly placeholder?: string;
    readonly kind: 'text' | 'number' | 'list';
}

export const DebugToolsService = Symbol('IngotDebugToolsService');

/** Backend: checks whether a runtime (JDK, PHP + Xdebug, Node, Python) is installed. */
export interface DebugToolsService {
    check(kind: DebugRuntimeKind): Promise<RuntimeStatus>;
}
