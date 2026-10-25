import { describe, expect, it } from 'vitest';
import { contextSegments, contextUsage, messageWeights } from './context-usage';

describe('context ring breakdown (IDEA-98)', () => {
    const usage = contextUsage({ system: 100, rules: 50, files: 20, memories: 10, history: 400 }, 1000);

    it('weighs chip contents and tool output in the conversation', () => {
        const w = messageWeights([
            { role: 'user', text: 'see [a.ts]', expanded: `see ${'x'.repeat(400)}`, chips: [{}] },
            { role: 'tool', text: 'y'.repeat(200) },
            { role: 'agent', text: 'ok' }
        ]);
        expect(w.tools).toBe(50);
        expect(w.chips).toBeGreaterThan(90);
    });

    it('splits the window into segments that add up to the total', () => {
        const segments = contextSegments(usage, { chips: 100, tools: 50 });
        expect(segments.map(s => s.id)).toEqual(['system', 'rules', 'files', 'history', 'tools', 'memories']);
        expect(segments.reduce((n, s) => n + s.tokens, 0)).toBe(usage.total);
        expect(segments.find(s => s.id === 'files')!.tokens).toBe(120);
        expect(segments.find(s => s.id === 'history')!.tokens).toBe(250);
    });

    it('never goes negative when estimates exceed the history', () => {
        const segments = contextSegments(usage, { chips: 900, tools: 900 });
        expect(segments.every(s => s.tokens >= 0)).toBe(true);
    });
});
