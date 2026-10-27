import { describe, expect, it } from 'vitest';
import type { AgentSession } from './agents.types';
import { subagentInfo, subagentState, subagentsSummary, subagentsView } from './subagents';

const session = (over: Partial<AgentSession>): AgentSession => ({
    id: 'c1', title: 'Write tests', status: 'thinking', updatedAt: 0, mode: 'agent', model: 'm', messages: [{ role: 'user', text: 'Write the tests' }],
    plan: [], steps: [], changes: [], ...over
});

describe('subagents (IDEA-181)', () => {
    it('maps chat status to a subagent state', () => {
        expect(subagentState('thinking', false)).toBe('running');
        expect(subagentState('done', true)).toBe('running');
        expect(subagentState('review', false)).toBe('review');
        expect(subagentState('error', false)).toBe('error');
        expect(subagentState('idle', false)).toBe('done');
        expect(subagentState('done', false)).toBe('done');
    });

    it('shows progress and a one-line detail', () => {
        const plan = [{ text: 'a', state: 'done' as const }, { text: 'b', state: 'active' as const }, { text: 'c', state: 'todo' as const }, { text: 'd', state: 'todo' as const }];
        expect(subagentInfo(session({ plan }), true)).toMatchObject({ state: 'running', progress: 0.25, detail: '1 of 4 steps', task: 'Write the tests', who: 'ingot' });
        expect(subagentInfo(session({ activeFile: 'src/a.test.ts' }), true)).toMatchObject({ progress: undefined, detail: 'Editing a.test.ts' });
        expect(subagentInfo(session({ status: 'review', agent: 'zaprex', changes: [{ uri: 'u', label: 'a', added: 1, removed: 0 }] }), false))
            .toMatchObject({ who: 'zaprex', state: 'review', progress: 1, detail: 'Waiting for review · 1 file changed' });
        expect(subagentInfo(session({ status: 'done' }), false).detail).toBe('Answered');
    });

    it('sums up the strip', () => {
        const infos = [subagentInfo(session({}), true), subagentInfo(session({ status: 'done' }), false), subagentInfo(session({ status: 'done' }), false)];
        expect(subagentsSummary(infos)).toBe('1 running · 2 done');
        expect(subagentsView('compact')).toBe('compact');
        expect(subagentsView('x')).toBe('strip');
    });
});
