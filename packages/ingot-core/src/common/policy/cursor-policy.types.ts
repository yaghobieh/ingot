import type { NetworkDefault, SandboxMode } from './agent-policy.types';

/** IDEA-287: what Cursor's cli.json permissions, sandbox.json and permissions.json add to the Ingot policy. */
export interface PolicyOverlay {
    readonly commandsAllow: readonly string[];
    readonly commandsDeny: readonly string[];
    readonly readOnly: readonly string[];
    readonly networkAllow: readonly string[];
    readonly networkDeny: readonly string[];
    readonly allowWrite: readonly string[];
    /** permissions.json `mcpAllowlist`: `server:tool` patterns that run without the approval card. */
    readonly mcpAllow: readonly string[];
    /** permissions.json `autoRun` guidance for auto-review. */
    readonly autoRunAllow: readonly string[];
    readonly autoRunBlock: readonly string[];
    readonly networkDefault?: NetworkDefault;
    readonly sandboxMode?: SandboxMode;
    /** Tokens Ingot has no rule for (`Read(…)`, `Mcp(…)`), shown so nothing is silently dropped. */
    readonly ignored: readonly string[];
}

export type CursorPermissionKind = 'Shell' | 'Read' | 'Write' | 'WebFetch' | 'Mcp';

/** One Cursor policy file: its label (`.cursor/cli.json`, `~/.cursor/sandbox.json`) and what it adds. */
export interface PolicySourceOverlay {
    readonly file: string;
    readonly overlay: PolicyOverlay;
}
