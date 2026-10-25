// Copied from ingot-server packages/shared/src/ide-auth.types.ts (canonical copy). Keep in sync; do not edit here.
import type { IDE_ACTIVITY_STATUSES } from './ide-auth.consts';
import type { BalanceResponse } from './usage.types';

export type IdeGrantType = 'authorization_code' | 'refresh_token' | 'urn:ingot:grant-type:handoff';

export interface IdeTokenResponse {
    access_token: string;
    refresh_token: string;
    token_type: 'Bearer';
    expires_in: number;
    refresh_expires_in: number;
}

export interface IdeTokenError {
    error: 'invalid_request' | 'invalid_grant' | 'unsupported_grant_type';
    message?: string;
}

export interface IdeHandoffResponse {
    /** ingot://auth?code=... (open it to hand the signed-in session to the IDE). */
    url: string;
    expiresIn: number;
}

export type GatewayMode = 'native' | 'litellm';

export interface GatewayKeyResponse {
    /** OpenAI-compatible base URL (ingot-server `/v1` in native mode, LiteLLM in legacy mode). */
    baseUrl: string;
    /** LiteLLM virtual key; empty in native mode, where the IDE sends its own access token. */
    key: string;
    mode?: GatewayMode;
    plan: string;
    models: string[];
    limits: GatewayPlanLimits;
}

export interface GatewayPlanLimits {
    /** Max spend in USD per budget window; null = unlimited. */
    maxBudgetUsd: number | null;
    budgetDuration: string;
    rpm: number;
    tpm: number;
}

export type IdeActivityStatus = typeof IDE_ACTIVITY_STATUSES[number];

/** What the IDE reports about its current agent / process (heartbeat). */
export interface IdeActivityReport {
    status: IdeActivityStatus;
    /** Agent or process name, e.g. "Agent 1" or "Indexing". */
    agent?: string;
    /** Short human text, e.g. "Editing src/app.ts". Never secrets or file contents. */
    detail?: string;
    model?: string;
    workspace?: string;
}

export interface IdeActivity extends Required<Omit<IdeActivityReport, 'model' | 'workspace'>> {
    sessionId: string;
    clientName: string;
    model: string | null;
    workspace: string | null;
    updatedAt: string;
    online: boolean;
}

export interface IdeAccount {
    id: string;
    email: string;
    name: string;
    avatarUrl: string;
    plan: string;
}

/** GET /api/ide/status: everything the IDE status bar / account menu shows, in one call. */
export interface IdeStatusResponse {
    user: IdeAccount;
    balance: BalanceResponse;
    activity: IdeActivity[];
}

/** Result of parsing an ingot:// URL the OS handed to the IDE. */
export type IdeDeepLink =
    | { kind: 'handoff'; code: string }
    | { kind: 'callback'; code: string; state: string }
    | { kind: 'error'; error: string; state?: string }
    | { kind: 'unknown' };
