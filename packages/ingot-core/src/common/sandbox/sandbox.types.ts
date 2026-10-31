/** IDEA-288: sandbox and approval presets for the agent's tools, stored per project in `.ingot/policy.json`. */

/** `read-only`: the agent only reads. `workspace-write`: it edits and runs commands inside the project. `full-access`: no limits. */
export type SandboxMode = 'read-only' | 'workspace-write' | 'full-access';

/** What happens when an action leaves the sandbox: `on-request` asks, `never` refuses, `auto-review` asks a cheap model first. */
export type ApprovalMode = 'on-request' | 'never' | 'auto-review';

export interface SandboxPreset {
    readonly sandbox: SandboxMode;
    readonly approvals: ApprovalMode;
    /** Workspace-write only: commands may reach the network without asking. */
    readonly network: boolean;
}

/** What one tool call or edit would do, as far as the sandbox cares. */
export interface ToolIntent {
    /** Changes files (or processes) inside the project. */
    readonly writes: boolean;
    /** Writes outside the project (absolute paths, `~`, `sudo`, a cwd outside the project). */
    readonly outsideWrite: boolean;
    readonly network: boolean;
    /** Touches `.ingot/policy.json`, so the agent could loosen its own sandbox. */
    readonly protectedPath: boolean;
}

export type SandboxVerdict = 'inside' | 'outside';

export interface SandboxCheck {
    readonly verdict: SandboxVerdict;
    /** Why the action leaves the sandbox ("uses the network", "writes outside the project"). */
    readonly reasons: readonly string[];
}

/** `run`: go ahead. `ask`: the approval card. `refuse`: blocked without a card. `review`: auto-review decides first. */
export type GateDecision = 'run' | 'ask' | 'refuse' | 'review';

export type RiskLevel = 'low' | 'high';

export interface RiskAssessment {
    readonly risk: RiskLevel;
    readonly reason: string;
    /** `model`: the reviewer answered. `budget` / `error`: no answer, so it counts as high risk and the user decides. */
    readonly source: 'model' | 'budget' | 'error';
}

/** The cheap model behind auto-review; tests pass a fake. */
export interface RiskModel {
    complete(system: string, user: string, maxTokens: number): Promise<string>;
}

export interface ToolCallLike {
    readonly server: string;
    readonly tool: string;
    readonly args: Record<string, unknown>;
}
