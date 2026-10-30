/**
 * IDEA-263: one line of the agent audit log per tool call. `auto`: ran without asking; `allowed`: the policy's allow
 * list skipped the card; `approved` / `always`: the user chose Run / Always Run; `skipped` / `stopped`: the user did not
 * run it; `denied`: the policy (or a guard) refused it.
 */
export type AuditDecision = 'auto' | 'allowed' | 'approved' | 'always' | 'skipped' | 'stopped' | 'denied';

/** `blocked`: refused before running, or stopped by the sandbox. */
export type AuditOutcome = 'ok' | 'error' | 'blocked' | 'skipped';

export interface AuditEntryInput {
    readonly sessionId: string;
    readonly chat?: string;
    readonly project?: string;
    /** `server/tool`, e.g. `ingot/run` or `ingot/edit`. */
    readonly tool: string;
    /** What happened in one line, e.g. "Run command: npm test". */
    readonly summary: string;
    readonly args: Record<string, unknown>;
    readonly decision: AuditDecision;
    readonly reason?: string;
    readonly outcome: AuditOutcome;
    readonly output?: string;
    readonly durationMs?: number;
    /** The command ran inside the OS sandbox. */
    readonly sandboxed?: boolean;
}

export interface AuditEntry extends AuditEntryInput {
    readonly seq: number;
    /** ISO time stamped by the backend when the line was written. */
    readonly at: string;
    /** Hash of the previous line (the genesis value for the first). */
    readonly prev: string;
    /** SHA-256 over `prev` and this line's content, so edits and removed lines are detected. */
    readonly hash: string;
}

export interface AuditVerifyResult {
    readonly ok: boolean;
    readonly count: number;
    /** Sequence number of the first line that does not chain. */
    readonly brokenAt?: number;
    readonly reason?: string;
}

export const AgentAuditService = Symbol('IngotAgentAuditService');

/** Append-only by design: there is no way to change or remove a line through the service. */
export interface AgentAuditService {
    append(input: AuditEntryInput): Promise<AuditEntry>;
    /** The newest `limit` entries, oldest first. */
    list(limit?: number): Promise<AuditEntry[]>;
    verify(): Promise<AuditVerifyResult>;
    /** Absolute path of the log file. */
    location(): Promise<string>;
}
