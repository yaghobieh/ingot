import { describe, expect, it } from 'vitest';
import { buildEnvelope, createErrorReporter, parseDsn, scrubTags, scrubText } from './error-reporter';

describe('error reporter (IDEA-149)', () => {
    it('is off without a valid DSN', async () => {
        expect(createErrorReporter({ component: 'test' }).enabled).toBe(false);
        expect(createErrorReporter({ component: 'test', dsn: 'not a url' }).enabled).toBe(false);
        expect(parseDsn('https://abc@o1.ingest.example.com/42')).toEqual({ envelopeUrl: 'https://o1.ingest.example.com/api/42/envelope/', publicKey: 'abc' });
    });
    it('scrubs secrets and personal data', () => {
        const text = scrubText('user ana@example.com from 10.1.2.3 sent Bearer abc.def key sk-proj-ABCDEFGH12345678 to https://u:pw123456@db.example.com/x?token=zzz&id=1 in /Users/john/app 0b7f0a3e-1111-2222-3333-444455556666');
        for (const leaked of ['ana@example.com', '10.1.2.3', 'abc.def', 'sk-proj', 'pw123456', 'zzz', 'john', '0b7f0a3e']) { expect(text).not.toContain(leaked); }
        expect(text).toContain('id=1');
        expect(scrubTags({ route: '/api/x', userEmail: 'a@b.co', password: 'x', status: 500, nested: { a: 1 } })).toEqual({ route: '/api/x', status: '500' });
    });
    it('builds a Sentry envelope with scrubbed exception only', () => {
        const error = new Error('failed for ana@example.com with sk-live-ABCDEFGHIJKL');
        const lines = buildEnvelope(error, { dsn: 'https://k@h/1', component: 'server', release: '0.1.0' }, { route: '/api/billing' }).trim().split('\n');
        expect(lines).toHaveLength(3);
        const event = JSON.parse(lines[2]);
        expect(event).toMatchObject({ release: '0.1.0', tags: { component: 'server', route: '/api/billing' } });
        expect(JSON.stringify(event)).not.toMatch(/ana@example|sk-live/);
        expect(event.user).toBeUndefined();
        expect(event.request).toBeUndefined();
    });
    it('sends to the envelope endpoint and never throws', async () => {
        const calls: string[] = [];
        const reporter = createErrorReporter({ component: 't', dsn: 'https://k@h.example.com/7', fetchImpl: (async (url: string) => { calls.push(url); throw new Error('offline'); }) as unknown as typeof fetch });
        await expect(reporter.capture(new Error('x'))).resolves.toBeUndefined();
        expect(calls).toEqual(['https://h.example.com/api/7/envelope/']);
    });
});
