import { AUDIT_ARG_CHARS, AUDIT_GENESIS, AUDIT_OUTPUT_CHARS, REDACTED, SECRET_ARG_NAMES, SECRET_PATTERNS } from './agent-audit.consts';
import type { AuditEntry, AuditEntryInput, AuditVerifyResult } from './agent-audit.types';

export const cap = (text: string, max: number): string => text.length > max ? `${text.slice(0, max)}… (+${text.length - max})` : text;

/** Replaces anything that looks like a key, token or password with `[redacted]`. */
export const redact = (text: string): string => SECRET_PATTERNS.reduce(
    (out, pattern) => out.replace(pattern, (match: string, prefix?: string) => typeof prefix === 'string' && match.startsWith(prefix) ? `${prefix}${REDACTED}` : REDACTED),
    text
);

/** Tool arguments as they are logged: secrets redacted, long strings capped, nesting kept shallow. */
export const sanitizeArgs = (args: Record<string, unknown>): Record<string, unknown> => {
    const out: Record<string, unknown> = {};
    for (const [key, value] of Object.entries(args)) {
        if (SECRET_ARG_NAMES.test(key)) {
            out[key] = REDACTED;
        } else if (typeof value === 'string') {
            out[key] = cap(redact(value), AUDIT_ARG_CHARS);
        } else if (typeof value === 'number' || typeof value === 'boolean' || value === null) {
            out[key] = value;
        } else {
            out[key] = cap(redact(JSON.stringify(value) ?? ''), AUDIT_ARG_CHARS);
        }
    }
    return out;
};

export const sanitizeInput = (input: AuditEntryInput): AuditEntryInput => ({
    ...input,
    summary: cap(redact(input.summary), AUDIT_ARG_CHARS),
    args: sanitizeArgs(input.args),
    ...(input.reason !== undefined ? { reason: cap(redact(input.reason), AUDIT_ARG_CHARS) } : {}),
    ...(input.output !== undefined ? { output: cap(redact(input.output), AUDIT_OUTPUT_CHARS) } : {})
});

/** JSON with sorted keys, so the same entry always hashes the same. */
export const canonicalJson = (value: unknown): string => {
    if (Array.isArray(value)) {
        return `[${value.map(canonicalJson).join(',')}]`;
    }
    if (value && typeof value === 'object') {
        const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined).sort(([a], [b]) => a.localeCompare(b));
        return `{${entries.map(([k, v]) => `${JSON.stringify(k)}:${canonicalJson(v)}`).join(',')}}`;
    }
    return JSON.stringify(value) ?? 'null';
};

/** The text a line's hash covers: the previous hash, then the line without its own hash. */
export const hashPayload = (entry: Omit<AuditEntry, 'hash'>): string => `${entry.prev}\n${canonicalJson(entry)}`;

export const nextEntry = (input: AuditEntryInput, last: Pick<AuditEntry, 'seq' | 'hash'> | undefined, at: string, sha256: (text: string) => string): AuditEntry => {
    const body: Omit<AuditEntry, 'hash'> = { ...sanitizeInput(input), seq: (last?.seq ?? 0) + 1, at, prev: last?.hash ?? AUDIT_GENESIS };
    return { ...body, hash: sha256(hashPayload(body)) };
};

export const parseLines = (text: string): { entries: AuditEntry[]; badLine?: number } => {
    const entries: AuditEntry[] = [];
    const lines = text.split('\n').filter(line => line.trim());
    for (const [i, line] of lines.entries()) {
        try {
            entries.push(JSON.parse(line) as AuditEntry);
        } catch {
            return { entries, badLine: i + 1 };
        }
    }
    return { entries };
};

/** Walks the chain: every line must hash to its `hash`, point at the previous one and count up by one. */
export const verifyChain = (text: string, sha256: (text: string) => string): AuditVerifyResult => {
    const { entries, badLine } = parseLines(text);
    let prev = AUDIT_GENESIS;
    for (const [i, entry] of entries.entries()) {
        const { hash, ...body } = entry;
        if (entry.seq !== i + 1) {
            return { ok: false, count: entries.length, brokenAt: i + 1, reason: `Line ${i + 1} has sequence ${entry.seq}: lines were removed or reordered.` };
        }
        if (entry.prev !== prev) {
            return { ok: false, count: entries.length, brokenAt: entry.seq, reason: `Line ${entry.seq} does not point at the line before it.` };
        }
        if (sha256(hashPayload(body)) !== hash) {
            return { ok: false, count: entries.length, brokenAt: entry.seq, reason: `Line ${entry.seq} was changed after it was written.` };
        }
        prev = hash;
    }
    if (badLine !== undefined) {
        return { ok: false, count: entries.length, brokenAt: badLine, reason: `Line ${badLine} is not valid JSON.` };
    }
    return { ok: true, count: entries.length };
};

/** Viewer filter: matches tool, summary, chat, project, reason and output. */
export const matchesQuery = (entry: AuditEntry, query: string): boolean => {
    const q = query.trim().toLowerCase();
    return !q || [entry.tool, entry.summary, entry.chat, entry.project, entry.reason, entry.output, entry.decision, entry.outcome]
        .some(field => field?.toLowerCase().includes(q));
};

export const formatDuration = (ms: number | undefined): string => {
    if (ms === undefined) {
        return '';
    }
    return ms < 1000 ? `${ms} ms` : `${(ms / 1000).toFixed(1)} s`;
};
