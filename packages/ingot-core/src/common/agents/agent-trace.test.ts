import { describe, expect, it } from 'vitest';
import { agentTrace } from './agent-trace';
import type { AgentSession } from './agents.types';

const session = (patch: Partial<AgentSession> = {}): AgentSession => ({
    id: 'chat-1', title: 'Library', status: 'thinking', updatedAt: 0, mode: 'agent', model: 'openrouter-haiku',
    messages: [], plan: [], steps: [], changes: [], ...patch
});

describe('agentTrace', () => {
    it('copies the plan, the steps and the messages', () => {
        const trace = agentTrace(session({
            plan: [{ text: 'Write the server', state: 'active' }],
            steps: [{ kind: 'edit', target: 'server/src/app.ts', done: true, added: 12, removed: 0 }],
            messages: [{ role: 'user', text: 'Create it' }, { role: 'agent', text: 'Writing files' }]
        }), true);
        expect(trace.running).toBe(true);
        expect(trace.plan).toEqual([{ text: 'Write the server', state: 'active' }]);
        expect(trace.steps[0]).toMatchObject({ kind: 'edit', target: 'server/src/app.ts', added: 12 });
        expect(trace.messages.map(m => m.text)).toEqual(['Create it', 'Writing files']);
    });

    it('names the tool behind a card and keeps hidden nudges marked', () => {
        const trace = agentTrace(session({
            messages: [
                { role: 'tool', from: 'ingot/run', text: 'Exit code 0.', tool: { server: 'ingot', tool: 'run', args: { command: 'npm test' }, state: 'done', startedAt: 1 } },
                { role: 'user', text: 'Keep going', hidden: true }
            ]
        }), false);
        expect(trace.messages[0]).toMatchObject({ tool: 'ingot/run', toolState: 'done', from: 'ingot/run', toolArgs: '{"command":"npm test"}' });
        expect(trace.messages[1].hidden).toBe(true);
    });

    it('shows a waiting question and approval', () => {
        const trace = agentTrace(session({
            ask: { question: 'Which port?' },
            approval: { id: 'a1', kind: 'terminal', label: 'Run command', detail: 'npm install' }
        }), true);
        expect(trace.ask).toBe('Which port?');
        expect(trace.approval).toBe('Run command: npm install');
    });
});
