import { createHash } from 'crypto';
import { describe, expect, it } from 'vitest';
import { AUDIT_GENESIS, REDACTED } from './agent-audit.consts';
import type { AuditEntryInput } from './agent-audit.types';
import { canonicalJson, formatAuditTime, formatDuration, matchesQuery, nextEntry, redact, sanitizeArgs, verifyChain } from './agent-audit.utils';

const sha256 = (text: string): string => createHash('sha256').update(text).digest('hex');
const AT = '2026-10-30T09:00:00.000Z';
const input = (patch: Partial<AuditEntryInput> = {}): AuditEntryInput => ({
    sessionId: 'chat-1', tool: 'ingot/run', summary: 'Run command: npm test', args: { command: 'npm test' }, decision: 'approved', outcome: 'ok', ...patch
});

const chain = (count: number): string => {
    const lines: string[] = [];
    let last: { seq: number; hash: string } | undefined;
    for (let i = 0; i < count; i++) {
        const entry = nextEntry(input({ summary: `call ${i}` }), last, AT, sha256);
        lines.push(JSON.stringify(entry));
        last = entry;
    }
    return `${lines.join('\n')}\n`;
};

const fakeKey = (prefix: string): string => `${prefix}${'x'.repeat(32)}`;

describe('redaction', () => {
    it('removes keys, tokens and passwords from text and arguments', () => {
        expect(redact('curl -H "Authorization: Bearer abcdefghijklmnop" x')).toBe(`curl -H "Authorization: Bearer ${REDACTED}" x`);
        expect(redact(`export OPENAI=${fakeKey('sk-proj-')}`)).toBe(`export OPENAI=${REDACTED}`);
        expect(redact('mysql --password=hunter2 db')).toBe(`mysql --password=${REDACTED} db`);
        expect(redact('npm test')).toBe('npm test');
        expect(sanitizeArgs({ token: 'abc', command: `echo ${fakeKey('ghp_')}`, depth: 2, nested: { apiKey: 'x' } }))
            .toEqual({ token: REDACTED, command: `echo ${REDACTED}`, depth: 2, nested: '{"apiKey":"x"}' });
    });
});

describe('hash chain', () => {
    it('chains each entry to the previous one and stamps sequence and time', () => {
        const first = nextEntry(input(), undefined, AT, sha256);
        const second = nextEntry(input(), first, AT, sha256);
        expect(first).toMatchObject({ seq: 1, prev: AUDIT_GENESIS, at: AT });
        expect(second).toMatchObject({ seq: 2, prev: first.hash });
        expect(first.hash).toMatch(/^[0-9a-f]{64}$/);
    });

    it('verifies an intact log', () => {
        expect(verifyChain(chain(3), sha256)).toEqual({ ok: true, count: 3 });
        expect(verifyChain('', sha256)).toEqual({ ok: true, count: 0 });
    });

    it('detects a changed, removed or broken line', () => {
        const lines = chain(3).trim().split('\n');
        const edited = lines.map((line, i) => i === 1 ? line.replace('"outcome":"ok"', '"outcome":"error"') : line).join('\n');
        expect(verifyChain(edited, sha256)).toMatchObject({ ok: false, brokenAt: 2, reason: expect.stringContaining('changed') });
        expect(verifyChain([lines[0], lines[2]].join('\n'), sha256)).toMatchObject({ ok: false, brokenAt: 2, reason: expect.stringContaining('removed') });
        expect(verifyChain(`${lines.join('\n')}\n{oops`, sha256)).toMatchObject({ ok: false, brokenAt: 4 });
    });

    it('hashes key order independently', () => {
        expect(canonicalJson({ b: 1, a: { d: [1, 2], c: undefined } })).toBe('{"a":{"d":[1,2]},"b":1}');
    });
});

describe('formatting', () => {
    it('shows the time today and the date before, and short durations', () => {
        const now = new Date(2026, 9, 30, 15, 0, 0);
        expect(formatAuditTime(new Date(2026, 9, 30, 9, 5, 7).toISOString(), now)).toBe('09:05:07');
        expect(formatAuditTime(new Date(2026, 9, 29, 23, 59, 0).toISOString(), now)).toBe('2026-10-29 23:59');
        expect(formatDuration(420)).toBe('420 ms');
        expect(formatDuration(2500)).toBe('2.5 s');
        expect(formatDuration(undefined)).toBe('');
    });
});

describe('matchesQuery', () => {
    it('finds entries by tool, summary, decision or output', () => {
        const entry = nextEntry(input({ decision: 'denied', output: 'Blocked by policy' }), undefined, AT, sha256);
        expect(matchesQuery(entry, 'npm TEST')).toBe(true);
        expect(matchesQuery(entry, 'denied')).toBe(true);
        expect(matchesQuery(entry, 'blocked by')).toBe(true);
        expect(matchesQuery(entry, 'git push')).toBe(false);
    });
});
