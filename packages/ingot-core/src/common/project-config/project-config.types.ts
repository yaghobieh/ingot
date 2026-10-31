/**
 * Where a rule / command / skill / server came from. `global*` are loaded from the user's home for every project
 * (`~/.ingot`, and imported global folders); project sources win on name conflicts.
 */
export type ConfigSource = 'ingot' | 'legacy' | 'external' | 'agents' | 'global' | 'global-imported' | 'team';

/**
 * IDEA-287: how a rule is applied, as in Cursor. `always`: every turn. `auto`: when a file in context matches its globs.
 * `agent`: listed by name and description; the agent reads it with `ingot/fetch_rule` when relevant. `manual`: only
 * when the user @-mentions it.
 */
export type RuleKind = 'always' | 'auto' | 'agent' | 'manual';

export interface ProjectRule {
    readonly name: string;
    readonly path: string;
    readonly source: ConfigSource;
    readonly description?: string;
    readonly globs: readonly string[];
    readonly alwaysApply: boolean;
    readonly kind: RuleKind;
    readonly body: string;
    /** Absolute file URI (for open / delete). */
    readonly uri?: string;
    /** IDEA-287: project-relative folder of a nested rule (`packages/web`); it only applies to files under it. */
    readonly scope?: string;
    /** IDEA-287: a team rule the user cannot turn off. */
    readonly enforced?: boolean;
}

/** IDEA-287: a file a rule points at with `@path` (Cursor's rule references), attached with the rule. */
export interface RuleReference {
    readonly path: string;
    readonly text: string;
}

/** IDEA-287: `.ingot/environment.json` (Cursor's `.cursor/environment.json`): how to set the project up and run it. */
export interface ProjectEnvironment {
    readonly install?: string;
    readonly start?: string;
    readonly terminals: readonly { readonly name: string; readonly command: string; readonly description?: string }[];
    /** IDEA-287: a Cursor cloud snapshot id (cloud agents only; shown, not used locally). */
    readonly snapshot?: string;
    /** IDEA-287: the image to build, as written (`dockerfile` / `context` relative to the folder of environment.json). */
    readonly build?: EnvironmentBuild;
    /** IDEA-287: a prebuilt image (`node:22`), the environment's name, the user commands run as, and ports it exposes. */
    readonly image?: string;
    readonly name?: string;
    readonly user?: string;
    readonly ports?: readonly EnvironmentPort[];
    readonly errors: readonly string[];
}

export interface EnvironmentPort {
    readonly port: number;
    readonly name?: string;
}

export interface EnvironmentBuild {
    readonly dockerfile: string;
    readonly context?: string;
}

/** IDEA-287: `build` paths resolved to project-relative paths. */
export interface ResolvedEnvironmentBuild {
    readonly dockerfile: string;
    readonly context: string;
}

/** IDEA-295: a rule written from the User Rules settings page. */
export interface RuleDraft {
    readonly name: string;
    readonly kind: RuleKind;
    readonly description?: string;
    /** Comma-separated globs for `auto` rules. */
    readonly globs?: string;
    readonly body: string;
}

/** IDEA-294: `.ingotignore` (agent + index) and `.ingotindexingignore` (index only) checks, project-relative paths. */
export interface IgnoreRules {
    /** Hidden from agent file tools, search, the @ picker and the index. */
    readonly agent: (path: string) => boolean;
    /** Kept out of the codebase index (quick open); agents may still read it. */
    readonly index: (path: string) => boolean;
}

export interface ProjectCommand {
    readonly name: string;
    readonly path: string;
    readonly source: ConfigSource;
    readonly description?: string;
    readonly body: string;
    readonly kind: 'command' | 'skill';
    readonly uri?: string;
    /** Argument hint from frontmatter `args` (IDEA-249), shown after the name in the `/` menu. */
    readonly args?: string;
}

export interface McpServerConfig {
    readonly name: string;
    readonly source: ConfigSource | 'user';
    readonly command?: string;
    readonly args?: readonly string[];
    /** Environment for the server. Values may be secrets: never logged or shown, only the keys. */
    readonly env?: Readonly<Record<string, string>>;
    readonly url?: string;
    readonly headers?: Readonly<Record<string, string>>;
    /** Env vars whose values live in the OS keychain (written as `"${keychain}"` in mcp.json). */
    readonly secretEnv?: readonly string[];
    /** HTTP headers whose values live in the OS keychain (e.g. Authorization). */
    readonly secretHeaders?: readonly string[];
    /** IDEA-287: dotenv file (relative to the project) whose variables are added to the server's environment. */
    readonly envFile?: string;
}

/** IDEA-287: values for `${workspaceFolder}`, `${userHome}`, `${env:NAME}` and friends in mcp.json (as in Cursor). */
export interface McpVariables {
    readonly workspaceFolder: string;
    readonly userHome: string;
    readonly pathSeparator: string;
    readonly env: Readonly<Record<string, string | undefined>>;
}

export interface ProjectConfig {
    readonly rules: readonly ProjectRule[];
    readonly commands: readonly ProjectCommand[];
    readonly mcpServers: readonly McpServerConfig[];
}

export type McpState = 'disabled' | 'starting' | 'connected' | 'error' | 'needs-auth';

export interface McpTool {
    readonly name: string;
    readonly description?: string;
    readonly inputSchema?: unknown;
}

export interface McpServerStatus {
    readonly name: string;
    readonly state: McpState;
    readonly tools: readonly McpTool[];
    readonly error?: string;
    /** Number of resources the server exposes (0 when it has none or does not support resources). */
    readonly resources?: number;
    /** Keychain-backed env vars that have no value yet (state `needs-auth`). */
    readonly missingSecrets?: readonly string[];
    /** Recent server stderr / connection log, secrets redacted (for "Show Output"). */
    readonly output?: string;
}

export interface McpToolResult {
    readonly text: string;
    readonly isError: boolean;
}

export const McpService = Symbol('McpService');
export interface McpService {
    /** Starts (or restarts) the given servers; servers not listed are stopped. `cwd` is the project root path. */
    sync(servers: McpServerConfig[], cwd: string): Promise<McpServerStatus[]>;
    status(): Promise<McpServerStatus[]>;
    callTool(server: string, tool: string, args: Record<string, unknown>): Promise<McpToolResult>;
    /** Stores an MCP secret in the OS keychain. Values never go to files or back to the frontend. */
    setSecret(server: string, name: string, value: string): Promise<void>;
    /** Removes all keychain secrets of a server. */
    deleteSecrets(server: string, names: string[]): Promise<void>;
}
