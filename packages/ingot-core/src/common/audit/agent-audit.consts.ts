import type { AuditDecision, AuditOutcome } from './agent-audit.types';

export const AGENT_AUDIT_SERVICE_PATH = '/services/ingot-agent-audit';

/** Under the Ingot config folder, outside every project, so the agent's tools cannot reach it. */
export const AUDIT_DIR = 'audit';
export const AUDIT_FILE = 'agent-audit.jsonl';
export const AUDIT_FILE_MODE = 0o600;
export const AUDIT_DIR_MODE = 0o700;

export const AUDIT_GENESIS = '0'.repeat(64);
export const AUDIT_LIST_LIMIT = 500;
export const AUDIT_OUTPUT_CHARS = 600;
export const AUDIT_ARG_CHARS = 400;
export const REDACTED = '[redacted]';

/**
 * Secrets that must never reach the log: API keys, tokens, bearer headers, `password=…` style values.
 * A first capture group is a prefix that is kept (`Bearer `, `password=`).
 */
export const SECRET_PATTERNS: readonly RegExp[] = [
    /\b(?:sk|pk|rk)-[A-Za-z0-9_-]{16,}\b/g,
    /\bgh[pousr]_[A-Za-z0-9]{20,}\b/g,
    /\bgithub_pat_[A-Za-z0-9_]{20,}\b/g,
    /\bxox[abprs]-[A-Za-z0-9-]{10,}\b/g,
    /\bAKIA[0-9A-Z]{16}\b/g,
    /\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\b/g,
    /(\bBearer\s+)[A-Za-z0-9._~+/-]{8,}=*/gi,
    /(\b(?:password|passwd|secret|token|api[_-]?key|auth)\s*[=:]\s*)("[^"]*"|'[^']*'|[^\s&;]+)/gi
];

/** Argument names whose values are always redacted. */
export const SECRET_ARG_NAMES = /^(password|passwd|secret|token|api[_-]?key|authorization|auth)$/i;

export const AUDIT_DECISION_LABELS: Record<AuditDecision, string> = {
    auto: 'Auto', allowed: 'Policy allow', approved: 'Approved', always: 'Always run', skipped: 'Skipped', stopped: 'Stopped', denied: 'Denied'
};

export const AUDIT_OUTCOME_LABELS: Record<AuditOutcome, string> = {
    ok: 'OK', error: 'Error', blocked: 'Blocked', skipped: 'Skipped'
};
