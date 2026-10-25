import { describe, expect, it } from 'vitest';
import type { AgentSession } from './agents.types';
import { activeAgentCount, agentSubtitle, changesSummary, relativeTime, titleFromPrompt } from './agents.utils';

const session = (over: Partial<AgentSession>): AgentSession => ({
    id: '1', title: 't', status: 'idle', updatedAt: 0, mode: 'agent', model: 'm', messages: [], plan: [], steps: [], changes: [], ...over
});

describe('agents utils', () => {
    it('formats relative times', () => {
        expect(relativeTime(0, 30_000)).toBe('just now');
        expect(relativeTime(0, 2 * 60_000)).toBe('2m');
        expect(relativeTime(0, 18 * 60_000)).toBe('18 min ago');
    });

    it('builds list subtitles like the design', () => {
        expect(agentSubtitle(session({ status: 'editing', activeFile: 'useCart.ts' }), 2 * 60_000)).toBe('Editing useCart.ts · 2m');
        expect(agentSubtitle(session({ status: 'review', changes: [1, 2, 3, 4].map(n => ({ uri: `${n}`, label: `${n}`, added: 1, removed: 0 })) }), 0)).toBe('Ready for review · 4 files');
        expect(agentSubtitle(session({ status: 'done' }), 18 * 60_000)).toBe('Done · 18 min ago');
    });

    it('counts active agents and summarises changes', () => {
        expect(activeAgentCount([session({ status: 'editing' }), session({ status: 'done' }), session({ status: 'review' })])).toBe(2);
        expect(changesSummary(1)).toBe('1 file changed');
    });

    it('derives titles from prompts', () => {
        expect(titleFromPrompt('  make addItem optimistic ')).toBe('Make addItem optimistic');
        expect(titleFromPrompt('x'.repeat(80))).toHaveLength(48);
    });
});
