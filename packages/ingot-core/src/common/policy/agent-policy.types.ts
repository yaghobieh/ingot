/** IDEA-263: `.ingot/policy.json`, the project's rules for what the agent's tools may do. */
export type NetworkDefault = 'allow' | 'deny';
export type SandboxMode = 'restricted' | 'off';

export interface CommandRules {
    /** Commands that run without the approval card when every part of the command line matches. */
    readonly allow: readonly string[];
    /** Commands that are refused at once. Wins over `allow`. */
    readonly deny: readonly string[];
}

export interface PathRules {
    /** Project-relative globs the agent may write (edit, create, delete). Empty: the whole project. */
    readonly writable: readonly string[];
    /** Project-relative globs the agent may never write, on top of the built-in ones. */
    readonly readOnly: readonly string[];
}

export interface NetworkRules {
    readonly default: NetworkDefault;
    readonly allow: readonly string[];
    readonly deny: readonly string[];
}

export interface SandboxRules {
    /** `restricted`: commands can only write inside the project (and caches); `off`: no sandbox. */
    readonly mode: SandboxMode;
    /** Extra folders commands may write in restricted mode (`~` is the home folder). */
    readonly allowWrite: readonly string[];
}

export interface AgentPolicy {
    readonly commands: CommandRules;
    readonly paths: PathRules;
    readonly network: NetworkRules;
    readonly sandbox: SandboxRules;
}

export interface PolicyLoad {
    readonly policy: AgentPolicy;
    readonly errors: readonly string[];
    readonly exists: boolean;
}

/**
 * `allow`: runs without the card. `deny`: refused. `ask`: the card is required (it reaches outside the project).
 * `default`: the usual approval settings decide.
 */
export type PolicyVerdict = 'allow' | 'deny' | 'ask' | 'default';

export interface PolicyDecision {
    readonly verdict: PolicyVerdict;
    readonly reason?: string;
}

/** What the backend needs to run one command in the sandbox. */
export interface SandboxSpec {
    /** Absolute folders the command may write: the project, its cwd, temp and package caches. */
    readonly writable: readonly string[];
    readonly network: NetworkDefault;
}

export interface PolicyContext {
    /** Absolute project root. */
    readonly root: string;
    /** Absolute working folder of a command (the root unless the call names another one). */
    readonly cwd?: string;
    /** The user's home folder, for `~` in commands. */
    readonly home?: string;
}
