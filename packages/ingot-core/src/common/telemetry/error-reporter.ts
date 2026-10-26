/**
 * IDEA-149: minimal Sentry-compatible error reporter (no SDK). Off unless a DSN is configured.
 * Sends only: error type, scrubbed message, scrubbed stack frames, release, environment, and a few tags.
 * Never sends: user ids, emails, IPs, cookies, headers, request bodies, tokens or keys.
 */

export interface ReporterOptions {
    dsn: string;
    release?: string;
    environment?: string;
    /** e.g. 'server', 'portal', 'ide-main', 'ide-renderer'. */
    component: string;
    fetchImpl?: typeof fetch;
}

export interface ParsedDsn {
    envelopeUrl: string;
    publicKey: string;
}

const SECRET_PATTERNS: [RegExp, string][] = [
    [/\b(Bearer|Basic)\s+[A-Za-z0-9._~+/=-]+/gi, '$1 [redacted]'],
    [/\b(sk|pk|rk)-[A-Za-z0-9_-]{8,}/g, '[redacted-key]'],
    [/\b(ingot|pdl|pri|ctm|sub|txn|apikey|pat)_[A-Za-z0-9_-]{8,}/gi, '[redacted-id]'],
    [/\b(gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})/g, '[redacted-token]'],
    [/\beyJ[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{10,}\.[A-Za-z0-9_-]{5,}/g, '[redacted-jwt]'],
    [/[a-z][a-z0-9+.-]*:\/\/[^\s:@/]+:[^\s@/]+@/gi, '[redacted-credentials]@'],
    [/([?&](?:token|key|secret|password|code|signature|session|auth)[^=&\s]*=)[^&\s#]+/gi, '$1[redacted]'],
    [/[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g, '[email]'],
    [/\b\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}\b/g, '[ip]'],
    [/\b[0-9a-f]{8}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{4}-[0-9a-f]{12}\b/gi, '[uuid]'],
    [/\/(Users|home)\/[^/\s]+/g, '/$1/[user]']
];
const SENSITIVE_KEY = /pass|secret|token|key|auth|cookie|session|email|phone|signature|card/i;
const MAX_TEXT = 2000;
const MAX_FRAMES = 50;
const TIMEOUT_MS = 3000;

export function scrubText(value: string): string {
    let text = value.slice(0, MAX_TEXT);
    for (const [pattern, replacement] of SECRET_PATTERNS) { text = text.replace(pattern, replacement); }
    return text;
}

/** Tags only: short strings / numbers / booleans, sensitive keys dropped, values scrubbed. */
export function scrubTags(tags: Record<string, unknown>): Record<string, string> {
    const clean: Record<string, string> = {};
    for (const [key, value] of Object.entries(tags)) {
        if (SENSITIVE_KEY.test(key) || value === undefined || value === null || typeof value === 'object') { continue; }
        clean[key.slice(0, 32)] = scrubText(String(value)).slice(0, 200);
    }
    return clean;
}

/** `https://<publicKey>@<host>/<projectId>` -> envelope endpoint. Undefined for anything else. */
export function parseDsn(dsn: string | undefined): ParsedDsn | undefined {
    if (!dsn) { return undefined; }
    try {
        const url = new URL(dsn.trim());
        const projectId = url.pathname.split('/').filter(Boolean).pop();
        if (!url.username || !projectId || !['https:', 'http:'].includes(url.protocol)) { return undefined; }
        const prefix = url.pathname.split('/').filter(Boolean).slice(0, -1).join('/');
        return { envelopeUrl: `${url.protocol}//${url.host}/${prefix ? `${prefix}/` : ''}api/${projectId}/envelope/`, publicKey: url.username };
    } catch {
        return undefined;
    }
}

function frames(stack: string | undefined) {
    if (!stack) { return []; }
    return stack.split('\n').slice(1, MAX_FRAMES + 1).map(line => {
        const match = /at (?:(.+?) \()?(.+?):(\d+):(\d+)\)?$/.exec(line.trim());
        return match
            ? { function: scrubText(match[1] ?? '?'), filename: scrubText(match[2]), lineno: Number(match[3]), colno: Number(match[4]) }
            : { function: scrubText(line.trim()).slice(0, 200) };
    }).reverse();
}

const eventId = () => Array.from({ length: 32 }, () => Math.floor(Math.random() * 16).toString(16)).join('');

/** Builds the envelope body (exported for tests). */
export function buildEnvelope(error: unknown, options: ReporterOptions, tags: Record<string, unknown> = {}, now = new Date()): string {
    const err = error instanceof Error ? error : new Error(typeof error === 'string' ? error : 'non-error thrown');
    const id = eventId();
    const event = {
        event_id: id, timestamp: now.toISOString(), platform: 'javascript', level: 'error',
        release: options.release, environment: options.environment ?? 'production',
        tags: { component: options.component, ...scrubTags(tags) },
        exception: { values: [{ type: err.name.slice(0, 100), value: scrubText(err.message), stacktrace: { frames: frames(err.stack) } }] }
    };
    const header = { event_id: id, sent_at: now.toISOString() };
    return `${JSON.stringify(header)}\n${JSON.stringify({ type: 'event' })}\n${JSON.stringify(event)}\n`;
}

export interface ErrorReporter {
    readonly enabled: boolean;
    capture(error: unknown, tags?: Record<string, unknown>): Promise<void>;
}

/** Disabled (no-op) unless the DSN parses. Never throws, never blocks longer than 3 s. */
export function createErrorReporter(options: Partial<ReporterOptions> & { component: string }): ErrorReporter {
    const parsed = parseDsn(options.dsn);
    if (!parsed) { return { enabled: false, capture: async () => undefined }; }
    const send = options.fetchImpl ?? fetch;
    return {
        enabled: true,
        async capture(error, tags = {}) {
            try {
                await send(parsed.envelopeUrl, {
                    method: 'POST',
                    headers: { 'Content-Type': 'application/x-sentry-envelope', 'X-Sentry-Auth': `Sentry sentry_version=7, sentry_client=ingot-reporter/1.0, sentry_key=${parsed.publicKey}` },
                    body: buildEnvelope(error, { ...options, dsn: options.dsn ?? '' } as ReporterOptions, tags),
                    signal: AbortSignal.timeout(TIMEOUT_MS)
                });
            } catch {
                // Reporting must never break the app.
            }
        }
    };
}
