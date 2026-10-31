import type { AgentSession } from './agents.types';
import { actionLine } from './agent-actions';
import { APPROVAL_ID_PREFIX, BASE36, STEP_CHARS } from './agent-manager.consts';
import type { ApprovalEntry, ManagerCounts, ManagerRow, ManagerState } from './agent-manager.types';

const ACTIVE: readonly AgentSession['status'][] = ['thinking', 'editing'];

const clip = (text: string): string => {
    const one = text.replace(/\s+/g, ' ').trim();
    return one.length > STEP_CHARS ? `${one.slice(0, STEP_CHARS - 1)}…` : one;
};

export const managerState = (s: AgentSession, running: boolean): ManagerState => {
    if (s.approval) {
        return 'approval';
    }
    if (s.ask) {
        return 'question';
    }
    if (s.pause || s.status === 'paused') {
        return 'paused';
    }
    if (running || ACTIVE.includes(s.status)) {
        return 'running';
    }
    return s.status === 'review' ? 'review' : s.status === 'error' ? 'error' : s.status === 'done' ? 'done' : 'idle';
};

const base = (path: string): string => path.split('/').pop() ?? path;

/** What the chat is doing right now, in one line. */
export const currentStep = (s: AgentSession, running: boolean): string => {
    const state = managerState(s, running);
    switch (state) {
        case 'approval': return clip(actionLine(s.approval!));
        case 'question': return clip(s.ask!.question);
        case 'paused': return s.pause ? `Paused after ${s.pause.applied} of ${s.pause.total} files` : 'Paused';
        case 'running': {
            if (s.handoff?.message) {
                return clip(s.handoff.message);
            }
            const step = [...s.steps].reverse().find(st => !st.done);
            if (step) {
                return clip(`${step.kind === 'run' ? 'Running' : step.kind === 'edit' ? 'Editing' : step.kind === 'search' ? 'Searching' : 'Reading'} ${step.target}`);
            }
            if (s.status === 'editing' && s.activeFile) {
                return `Editing ${base(s.activeFile)}`;
            }
            const active = s.plan.find(p => p.state === 'active');
            return active ? clip(active.text) : 'Thinking…';
        }
        case 'review': {
            const files = s.changes.length || s.steps.filter(st => st.kind === 'edit').length;
            return `${files} ${files === 1 ? 'file' : 'files'} to review`;
        }
        case 'error': {
            const last = [...s.messages].reverse().find(m => m.role === 'system');
            return last ? clip(last.text) : 'Needs attention';
        }
        default: {
            const reply = [...s.messages].reverse().find(m => m.role === 'agent' && m.text && !m.hidden);
            return reply ? clip(reply.text.split('\n').find(l => l.trim()) ?? reply.text) : s.messages.length ? 'Done' : 'No messages yet';
        }
    }
};

const row = (s: AgentSession, depth: number, running: boolean): ManagerRow => ({
    id: s.id, title: s.title, depth, state: managerState(s, running), step: currentStep(s, running), who: s.agent === 'zaprex' ? 'zaprex' : 'ingot',
    ...(s.parent ? { parent: s.parent } : {}),
    ...(s.approval ? { approval: { id: s.approval.id, line: actionLine(s.approval) } } : {}),
    ...(s.worktree ? { worktree: s.worktree.branch } : {})
});

/** Chats newest first, each followed by its subagents (oldest first), at any depth. */
export const managerRows = (sessions: readonly AgentSession[], isRunning: (id: string) => boolean): ManagerRow[] => {
    const ids = new Set(sessions.map(s => s.id));
    const children = (id: string): AgentSession[] => sessions.filter(s => s.parent === id).sort((a, b) => (a.openedAt ?? a.updatedAt) - (b.openedAt ?? b.updatedAt));
    const out: ManagerRow[] = [];
    const walk = (s: AgentSession, depth: number): void => {
        out.push(row(s, depth, isRunning(s.id)));
        children(s.id).forEach(child => walk(child, depth + 1));
    };
    sessions.filter(s => !s.parent || !ids.has(s.parent)).sort((a, b) => b.updatedAt - a.updatedAt).forEach(s => walk(s, 0));
    return out;
};

/** Epoch ms from an approval id (`approval-<base36 time>-<n>`); 0 when it does not parse. */
export const approvalTime = (id: string): number => {
    const stamp = id.startsWith(APPROVAL_ID_PREFIX) ? id.slice(APPROVAL_ID_PREFIX.length).split('-')[0] : '';
    const value = parseInt(stamp, BASE36);
    return Number.isFinite(value) ? value : 0;
};

/** Every waiting approval, oldest first: the order they should be answered in. */
export const approvalQueue = (sessions: readonly AgentSession[]): ApprovalEntry[] => sessions
    .filter(s => s.approval)
    .map(s => ({ sessionId: s.id, approvalId: s.approval!.id, title: s.title, line: actionLine(s.approval!), askedAt: approvalTime(s.approval!.id) }))
    .sort((a, b) => a.askedAt - b.askedAt || a.sessionId.localeCompare(b.sessionId));

/** The approval after `current` (wrapping), or the oldest one when `current` is not waiting. */
export const nextApproval = (queue: readonly ApprovalEntry[], current?: string): ApprovalEntry | undefined => {
    if (!queue.length) {
        return undefined;
    }
    const at = queue.findIndex(entry => entry.sessionId === current);
    return queue[at < 0 ? 0 : (at + 1) % queue.length];
};

export const managerCounts = (rows: readonly ManagerRow[]): ManagerCounts => ({
    running: rows.filter(r => r.state === 'running').length,
    approvals: rows.filter(r => r.state === 'approval').length,
    total: rows.length
});
