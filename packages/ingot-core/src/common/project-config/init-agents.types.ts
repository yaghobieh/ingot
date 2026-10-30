/** IDEA-295: what `/init` reads from the repo to write AGENTS.md. */
export interface RepoSignals {
    /** Package name, else the folder name. */
    readonly name: string;
    readonly description?: string;
    readonly packageManager?: string;
    readonly scripts: Readonly<Record<string, string>>;
    /** Dependency and devDependency names. */
    readonly dependencies: readonly string[];
    /** Top-level file names. */
    readonly files: readonly string[];
    /** Top-level folder names (dependency and build folders left out). */
    readonly folders: readonly string[];
    readonly workspaces?: readonly string[];
    /** Existing rule files (`.ingot/rules/x.md`). */
    readonly rules: readonly string[];
}
