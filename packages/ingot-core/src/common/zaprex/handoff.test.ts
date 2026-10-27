import { describe, expect, it } from 'vitest';
import { handoffDeepLink, parseHandoffLink, parseResultBody, parseStatusBody, workingLine } from './handoff';

describe('Zaprex desktop handoff (IDEA-185)', () => {
    it('round-trips the deep link', () => {
        const link = handoffDeepLink('h_abc', 51234, 'tok/+=');
        expect(link.startsWith('zaprex://harmony?v=1&id=h_abc&port=51234&token=')).toBe(true);
        expect(parseHandoffLink(link)).toEqual({ id: 'h_abc', port: 51234, token: 'tok/+=', v: 1 });
        expect(parseHandoffLink('zaprex://harmony?id=x&port=99999&token=t')).toBeUndefined();
        expect(parseHandoffLink('https://evil/harmony?id=x&port=1&token=t')).toBeUndefined();
    });

    it('validates status bodies', () => {
        expect(parseStatusBody({ state: 'working', progress: 0.5, message: 'Writing tests' })).toEqual({ state: 'working', progress: 0.5, message: 'Writing tests' });
        expect(parseStatusBody({ state: 'working', progress: 7 })).toEqual({ state: 'working' });
        expect('error' in parseStatusBody({ state: 'done' })).toBe(true);
    });

    it('keeps result edits inside the piece scope', () => {
        const scope = ['**/*.test.*'];
        expect(parseResultBody({ summary: 'ok', edits: [{ path: 'src/a.test.ts', content: 'x' }] }, scope)).toEqual({ summary: 'ok', edits: [{ path: 'src/a.test.ts', content: 'x' }] });
        expect(parseResultBody({ edits: [{ path: 'src/a.ts', content: 'x' }] }, scope)).toEqual({ error: expect.stringContaining('outside this piece') });
        expect(parseResultBody({ edits: [{ path: '../x.test.ts', content: 'x' }] }, scope)).toEqual({ error: expect.stringContaining('not a project-relative path') });
    });

    it('says what both sides do', () => {
        expect(workingLine({ label: 'Write the tests', lead: { title: 'CSV export', task: 'add CSV export' } })).toBe('Working on Write the tests while Ingot works on CSV export');
    });
});
