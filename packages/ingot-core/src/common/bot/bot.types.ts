/** Ingot Bot (IDEA-154): the IDE side of the background agent. Shapes mirror ingot-server `/api/bot`. */
export type BotRunStatus = 'queued' | 'starting' | 'running' | 'awaiting_approval' | 'finishing' | 'succeeded' | 'failed' | 'cancelled' | 'timed_out';

export interface BotRun {
    readonly id: string;
    readonly status: BotRunStatus;
    readonly prompt: string;
    readonly source: string;
    readonly repoId: string | null;
    readonly repoFullName: string | null;
    readonly prNumber: number | null;
    readonly prUrl: string | null;
    readonly summary: string;
    readonly computeSeconds: number;
    readonly error: string | null;
    readonly createdAt: string;
    readonly startedAt: string | null;
    readonly endedAt: string | null;
}

export interface BotMessage {
    readonly id: number;
    readonly role: 'user' | 'bot';
    readonly kind: string;
    readonly text: string;
    readonly runId: string | null;
    readonly approvalId: string | null;
    readonly createdAt: string;
}

export interface BotApproval {
    readonly id: string;
    readonly runId: string;
    readonly action: string;
    readonly title: string;
    readonly reason: string;
    readonly preview: string;
    readonly status: string;
}

export interface BotEvent {
    readonly seq: number;
    readonly type: string;
    readonly payload: Record<string, unknown>;
    readonly createdAt: string;
}

export interface BotRepo {
    readonly id: string;
    readonly fullName: string;
    readonly defaultBranch: string;
    readonly enabled: boolean;
}

export interface BotEntitlement {
    readonly enabled: boolean;
    readonly plan: string;
    readonly reason: string | null;
}

export interface BotUsage {
    readonly minutesUsed: number;
    readonly minutesLimit: number | null;
    readonly activeRuns: number;
    readonly concurrentLimit: number | null;
}

export type BotDecision = 'approve_once' | 'approve_run' | 'reject';

/** One call to `/api/bot…` through the account backend; status 0 when signed out or offline. */
export interface BotResponse {
    readonly status: number;
    readonly body: Record<string, unknown>;
}

/** Everything the Bot panel shows. */
export interface BotSnapshot {
    readonly signedIn: boolean;
    readonly loading: boolean;
    readonly entitlement?: BotEntitlement;
    readonly usage?: BotUsage;
    readonly runner?: string;
    /** False = the server answers with the mock model (test mode). */
    readonly modelsLive?: boolean;
    readonly runnerLive?: boolean;
    readonly repos: readonly BotRepo[];
    readonly repoId: string;
    readonly messages: readonly BotMessage[];
    readonly approvals: readonly BotApproval[];
    readonly runs: readonly BotRun[];
    readonly error?: string;
}
