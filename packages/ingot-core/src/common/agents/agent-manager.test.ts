import { describe, expect, it } from 'vitest';
import type { AgentSession } from './agents.types';
import { approvalQueue, approvalTime, currentStep, managerCounts, managerRows, managerState, nextApproval } from './agent-manager';

const session = (id: string, patch: Partial<AgentSession> = {}): AgentSession => ({
    id, title: id, status: 'idle', updatedAt: 1, mode: 'agent', model: 'auto', messages: [], plan: [], steps: [], changes: [], ...patch
});
const approval = (at: number, detail: string) => ({ id: `approval-${at.toString(36)}-1`, kind: 'terminal' as const, label: 'Run command', detail, command: detail });

describe('IDEA-291 Agent Manager', () => {
    it('derives a state from status, approval, question and the running flag', () => {
        expect(managerState(session('a', { approval: approval(1, 'ls') }), true)).toBe('approval');
        expect(managerState(session('a', { ask: { question: 'Which?' } }), true)).toBe('question');
        expect(managerState(session('a'), true)).toBe('running');
        expect(managerState(session('a', { status: 'review' }), false)).toBe('review');
        expect(managerState(session('a', { status: 'done' }), false)).toBe('done');
    });

    it('describes the current step in one line', () => {
        expect(currentStep(session('a', { approval: approval(1, 'npm test') }), true)).toBe('Run command: npm test');
        expect(currentStep(session('a', { steps: [{ kind: 'run', target: 'subagent Parse CSV', done: false }] }), true)).toBe('Running subagent Parse CSV');
        expect(currentStep(session('a', { status: 'editing', activeFile: 'src/a/b.ts' }), true)).toBe('Editing b.ts');
        expect(currentStep(session('a', { plan: [{ text: 'Step one', state: 'done' }, { text: 'Step two', state: 'active' }] }), true)).toBe('Step two');
        expect(currentStep(session('a', { status: 'review', changes: [{ uri: 'u', label: 'a.ts', added: 1, removed: 0 }] }), false)).toBe('1 file to review');
        expect(currentStep(session('a', { messages: [{ role: 'agent', text: '\nAll good.\nMore' }] }), false)).toBe('All good.');
    });

    it('lists chats newest first with their subagents nested under them', () => {
        const rows = managerRows([
            session('old', { updatedAt: 1 }),
            session('lead', { updatedAt: 5 }),
            session('sub-2', { parent: 'lead', openedAt: 3, worktree: { path: '/tmp/x', branch: 'ingot/task-x' } }),
            session('sub-1', { parent: 'lead', openedAt: 2 })
        ], id => id === 'sub-1');
        expect(rows.map(r => [r.id, r.depth])).toEqual([['lead', 0], ['sub-1', 1], ['sub-2', 1], ['old', 0]]);
        expect(rows[1].state).toBe('running');
        expect(rows[2].worktree).toBe('ingot/task-x');
        expect(managerCounts(rows)).toEqual({ running: 1, approvals: 0, total: 4 });
    });

    it('queues approvals oldest first and cycles through them', () => {
        const sessions = [session('b', { approval: approval(200, 'two') }), session('a', { approval: approval(100, 'one') }), session('c')];
        const queue = approvalQueue(sessions);
        expect(queue.map(q => q.sessionId)).toEqual(['a', 'b']);
        expect(approvalTime(queue[0].approvalId)).toBe(100);
        expect(nextApproval(queue)?.sessionId).toBe('a');
        expect(nextApproval(queue, 'a')?.sessionId).toBe('b');
        expect(nextApproval(queue, 'b')?.sessionId).toBe('a');
        expect(nextApproval(queue, 'c')?.sessionId).toBe('a');
        expect(nextApproval([], 'a')).toBeUndefined();
    });
});
