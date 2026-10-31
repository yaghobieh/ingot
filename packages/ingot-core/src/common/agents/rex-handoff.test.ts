import { describe, expect, it } from 'vitest';
import type { AgentSession } from './agents.types';
import { isHeavyRunWeight, promptSteps, runWeight, showRexHandoff } from './rex-handoff';
import { LONG_RUN_MS } from './rex-handoff.consts';
import type { RunWeight } from './rex-handoff.types';

const session = (patch: Partial<AgentSession> = {}): AgentSession => ({
    id: 'a', title: 't', status: 'thinking', updatedAt: 0, mode: 'agent', model: 'm', messages: [{ role: 'user', text: 'fix the typo' }],
    plan: [], steps: [], changes: [], ...patch
});
const light: RunWeight = { active: true, planSteps: 1, files: 1, toolSteps: 2, promptSteps: 0, runningMs: 1_000 };
const gate = { enabled: true, proPlus: true, canRex: true, heavy: true };

describe('Hand off to Rex', () => {
    it('counts numbered and bulleted prompt lines', () => {
        expect(promptSteps('do it')).toBe(0);
        expect(promptSteps('Plan:\n1. a\n2) b\n- c\n* d\n• e\n-not a step')).toBe(5);
    });

    it('measures a run from its plan, files, steps, prompt and time', () => {
        const weight = runWeight(session({
            messages: [{ role: 'user', text: '1. a\n2. b', chips: [{ label: 'x', path: 'src/x.ts' }, { label: 'sel', path: '' }] }],
            plan: [{ text: 'a', state: 'done' }, { text: 'b', state: 'active' }],
            steps: [{ kind: 'read', target: 'src/a.ts', done: true }, { kind: 'edit', target: 'src/a.ts', done: true }],
            changes: [{ uri: 'file:///p/src/a.ts', label: 'src/a.ts', added: 1, removed: 0 }, { uri: 'file:///p/src/b.ts', label: 'src/b.ts', added: 1, removed: 0 }]
        }), 5_000, 2_000, ['docs/c.md']);
        expect(weight).toEqual({ active: true, planSteps: 2, files: 4, toolSteps: 2, promptSteps: 2, runningMs: 3_000 });
        expect(runWeight(session({ status: 'done' }), 5_000).active).toBe(false);
        expect(runWeight(session({ status: 'review' }), 5_000).active).toBe(false);
        expect(runWeight(session({ status: 'approval' }), 5_000).active).toBe(true);
        expect(runWeight(session(), 5_000).runningMs).toBe(0);
    });

    it('is heavy only while running with many files, a multi-step plan or prompt, many steps, or a long run', () => {
        expect(isHeavyRunWeight(light)).toBe(false);
        expect(isHeavyRunWeight({ ...light, planSteps: 4 })).toBe(true);
        expect(isHeavyRunWeight({ ...light, promptSteps: 4 })).toBe(true);
        expect(isHeavyRunWeight({ ...light, files: 5 })).toBe(true);
        expect(isHeavyRunWeight({ ...light, toolSteps: 12 })).toBe(true);
        expect(isHeavyRunWeight({ ...light, runningMs: LONG_RUN_MS })).toBe(true);
        expect(isHeavyRunWeight({ ...light, planSteps: 9, files: 9, active: false })).toBe(false);
    });

    it('shows the T-rex only for PRO+ with Rex, the button on, and a heavy run', () => {
        expect(showRexHandoff(gate)).toBe(true);
        expect(showRexHandoff({ ...gate, heavy: false })).toBe(false);
        expect(showRexHandoff({ ...gate, proPlus: false })).toBe(false);
        expect(showRexHandoff({ ...gate, canRex: false })).toBe(false);
        expect(showRexHandoff({ ...gate, enabled: false })).toBe(false);
    });
});
