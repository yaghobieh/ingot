/** Ingot gateway error handling (IDEA-124): what the IDE does per `error.code` (docs/ide-client-contract.md §2). */

export type GatewayErrorKind =
    | 'rate_limited' | 'allowance' | 'model_disabled' | 'model_unavailable' | 'not_in_plan' | 'not_found' | 'upstream' | 'unauthorized' | 'blocked' | 'other';

export interface GatewayError {
    readonly status: number;
    readonly code: string;
    readonly kind: GatewayErrorKind;
    /** Already localized by the server. */
    readonly message: string;
    readonly retryAfterSeconds?: number;
    /** `plan` / `user` / `team` / `global` / `provider`. */
    readonly scope?: string;
    readonly reason?: string;
}

const ERROR_PREFIX = 'ingot-gateway-error:';
const MAX_RETRY_AFTER_SECONDS = 3600;

const KIND_BY_CODE: Record<string, GatewayErrorKind> = {
    rate_limited: 'rate_limited',
    token_allowance_exhausted: 'allowance', token_cap_reached: 'allowance', spend_cap_reached: 'allowance',
    model_disabled: 'model_disabled',
    provider_disabled: 'model_unavailable', model_unavailable: 'model_unavailable', hosted_models_paused: 'model_unavailable',
    model_not_in_plan: 'not_in_plan',
    model_not_found: 'not_found',
    upstream_rejected: 'upstream', all_providers_failed: 'upstream',
    unauthorized: 'unauthorized',
    account_blocked: 'blocked'
};

const FALLBACK_TEXT: Record<GatewayErrorKind, string> = {
    rate_limited: 'Too many requests right now.',
    allowance: 'You have used up your tokens for now.',
    model_disabled: 'This model was turned off.',
    model_unavailable: 'This model is not available right now. Try another model.',
    not_in_plan: 'This model is not on your plan.',
    not_found: 'This model no longer exists.',
    upstream: 'Model provider failed, try again.',
    unauthorized: 'Your session expired. Sign in again.',
    blocked: 'This account is blocked. Contact support.',
    other: 'The model request failed.'
};

const text = (value: unknown): string | undefined => typeof value === 'string' && value ? value : undefined;

/** Seconds from a `Retry-After` header (seconds or HTTP date), else the body's `retry_after_seconds`. */
export const retryAfterSeconds = (header: string | null | undefined, bodyValue: unknown, now = Date.now()): number | undefined => {
    let seconds: number | undefined;
    if (header) {
        const n = Number(header);
        seconds = Number.isFinite(n) ? n : (Date.parse(header) - now) / 1000;
    }
    if ((seconds === undefined || !Number.isFinite(seconds)) && typeof bodyValue === 'number') {
        seconds = bodyValue;
    }
    return seconds !== undefined && Number.isFinite(seconds) ? Math.min(MAX_RETRY_AFTER_SECONDS, Math.max(1, Math.ceil(seconds))) : undefined;
};

/** Parses a non-2xx gateway response. Undefined when the body is not an Ingot gateway error. */
export const parseGatewayError = (status: number, json: unknown, retryAfterHeader?: string | null, now = Date.now()): GatewayError | undefined => {
    const error = json && typeof json === 'object' ? (json as { error?: unknown }).error : undefined;
    const body = error && typeof error === 'object' ? error as Record<string, unknown> : undefined;
    const code = text(body?.code) ?? (typeof error === 'string' ? error : undefined);
    if (!code) {
        return undefined;
    }
    const kind = KIND_BY_CODE[code] ?? 'other';
    return {
        status, code, kind,
        message: text(body?.message) ?? FALLBACK_TEXT[kind],
        retryAfterSeconds: kind === 'rate_limited' ? retryAfterSeconds(retryAfterHeader, body?.retry_after_seconds, now) ?? 60 : undefined,
        scope: text(body?.scope),
        reason: text(body?.reason)
    };
};

/** Errors cross the frontend/backend RPC as strings; this keeps the structure. */
export const encodeGatewayError = (error: GatewayError): string => `${ERROR_PREFIX}${JSON.stringify(error)}`;

export const decodeGatewayError = (message: string): GatewayError | undefined => {
    const at = message.indexOf(ERROR_PREFIX);
    if (at < 0) {
        return undefined;
    }
    try {
        const parsed = JSON.parse(message.slice(at + ERROR_PREFIX.length)) as GatewayError;
        return typeof parsed.code === 'string' && typeof parsed.kind === 'string' ? parsed : undefined;
    } catch {
        return undefined;
    }
};

/** Models need re-fetching after these (the catalog or the plan changed server-side). */
export const refetchesModels = (error: GatewayError): boolean =>
    error.kind === 'model_disabled' || error.kind === 'model_unavailable' || error.kind === 'not_in_plan' || error.kind === 'not_found';

/** The chat switches to the default model after these. */
export const fallsBackToDefault = (error: GatewayError): boolean => error.kind === 'model_disabled' || error.kind === 'not_found';

/** "1:05" for a countdown. */
export const countdownLabel = (seconds: number): string => {
    const s = Math.max(0, Math.ceil(seconds));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
};

/** Portal page with plans, top-ups and Manage subscription (IDEA-147). */
export const billingUrl = (portalUrl: string): string => `${portalUrl.replace(/\/+$/, '')}/dashboard/billing`;

/** Buttons of the "out of allowance" prompt (IDEA-147). */
export const UPGRADE_ACTION = 'Upgrade';
export const UPGRADE_DISMISS = 'Not now';

/** Notification shown when hosted usage runs out; Upgrade opens the portal billing page. */
export const upgradePromptText = (error: GatewayError): string =>
    `${error.message} Upgrade your plan or top up hosted credit to keep going. Your own model keys keep working.`;

/** Chat text for a gateway error (IDEA-124). `fallback` = the model the chat switched to, if any. */
export const chatErrorText = (error: GatewayError, context: { portalUrl: string; fallback?: string }): string => {
    const portal = context.portalUrl.replace(/\/$/, '');
    switch (error.kind) {
        case 'allowance':
            return `${error.message} Upgrade or top up: ${portal}/dashboard/billing (usage: ${portal}/dashboard/usage).`;
        case 'model_disabled':
        case 'not_found':
            return `${error.message}${error.reason ? ` (${error.reason})` : ''}${context.fallback ? ` Switched to ${context.fallback}; send your message again.` : ''}`;
        case 'model_unavailable':
            return `${error.message} Pick another model from the model picker.`;
        case 'not_in_plan':
            return `${error.message} Upgrade at ${portal}/dashboard/billing, or pick another model.`;
        case 'upstream':
            return `${error.message} Use Retry to try again.`;
        default:
            return error.message;
    }
};

/** Countdown line while the chat waits out a 429. */
export const rateLimitText = (error: GatewayError, secondsLeft: number): string =>
    `${error.message} Retrying in ${countdownLabel(secondsLeft)}…`;
