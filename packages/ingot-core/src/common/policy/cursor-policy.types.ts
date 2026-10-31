import type { NetworkDefault, SandboxMode } from './agent-policy.types';

/** IDEA-287: what `.cursor/cli.json` permissions and `.cursor/sandbox.json` add to the Ingot policy. */
export interface PolicyOverlay {
    readonly commandsAllow: readonly string[];
    readonly commandsDeny: readonly string[];
    readonly readOnly: readonly string[];
    readonly networkAllow: readonly string[];
    readonly networkDeny: readonly string[];
    readonly allowWrite: readonly string[];
    readonly networkDefault?: NetworkDefault;
    readonly sandboxMode?: SandboxMode;
    /** Tokens Ingot has no rule for (`Read(…)`, `Mcp(…)`), shown so nothing is silently dropped. */
    readonly ignored: readonly string[];
}

export type CursorPermissionKind = 'Shell' | 'Read' | 'Write' | 'WebFetch' | 'Mcp';
