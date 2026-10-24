export type ConfigSource = 'ingot' | 'legacy' | 'external' | 'agents';

export interface ProjectRule {
    readonly name: string;
    readonly path: string;
    readonly source: ConfigSource;
    readonly description?: string;
    readonly globs: readonly string[];
    readonly alwaysApply: boolean;
    readonly body: string;
}

export interface ProjectCommand {
    readonly name: string;
    readonly path: string;
    readonly source: ConfigSource;
    readonly description?: string;
    readonly body: string;
    readonly kind: 'command' | 'skill';
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
}

export interface ProjectConfig {
    readonly rules: readonly ProjectRule[];
    readonly commands: readonly ProjectCommand[];
    readonly mcpServers: readonly McpServerConfig[];
}

export type McpState = 'disabled' | 'starting' | 'connected' | 'error';

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
}
