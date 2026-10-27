import type { AgentSession, AgentStatus } from './agents.types';

/**
 * IDEA-181: subagents (Multi-agent subtasks and Zaprex Harmony pieces) live outside the main chat, in a compact
 * strip above the composer. These helpers give each one a status, a progress value and a one-line summary.
 */
export const SUBAGENT_PREFS = { view: 'ingot.agents.subagents.view' } as const;
export type SubagentsView = 'strip' | 'compact';
export const SUBAGENT_VIEWS: readonly SubagentsView[] = ['strip', 'compact'];

export type SubagentState = 'running' | 'review' | 'done' | 'error' | 'stopped';

export interface SubagentInfo {
    readonly id: string;
    readonly title: string;
    readonly who: 'ingot' | 'zaprex';
    readonly state: SubagentState;
    /** 0..1 when known (plan steps done), undefined = indeterminate. */
    readonly progress?: number;
    /** e.g. "2 of 4 steps", "3 files changed", "Waiting for review". */
    readonly detail: string;
    readonly task: string;
}

const RUNNING: readonly AgentStatus[] = ['thinking', 'editing', 'approval', 'paused'];

export const subagentState = (status: AgentStatus, running: boolean): SubagentState =>
    running || RUNNING.includes(status) ? 'running' : status === 'review' ? 'review' : status === 'error' ? 'error' : 'done';

const files = (n: number): string => `${n} ${n === 1 ? 'file' : 'files'} changed`;

export const subagentInfo = (s: AgentSession, running: boolean): SubagentInfo => {
    const state = subagentState(s.status, running);
    const done = s.plan.filter(p => p.state === 'done').length;
    const progress = state === 'done' || state === 'review' ? 1 : s.handoff?.progress !== undefined ? s.handoff.progress : s.plan.length ? done / s.plan.length : undefined;
    const detail = state === 'running'
        ? s.handoff ? (s.handoff.message || 'Working in the Zaprex app…') : (s.plan.length ? `${done} of ${s.plan.length} steps` : s.activeFile ? `Editing ${s.activeFile.split('/').pop()}` : 'Working…')
        : state === 'review' ? `Waiting for review · ${files(s.changes.length || s.steps.filter(st => st.kind === 'edit').length)}`
            : state === 'error' ? 'Needs attention'
                : state === 'stopped' ? 'Stopped'
                    : s.changes.length || s.steps.some(st => st.kind === 'edit') ? files(s.changes.length || s.steps.filter(st => st.kind === 'edit').length) : 'Answered';
    const task = s.messages.find(m => m.role === 'user')?.text ?? s.title;
    return { id: s.id, title: s.title, who: s.agent === 'zaprex' ? 'zaprex' : 'ingot', state, progress, detail, task };
};

/** Header line of the strip, e.g. "Subagents · 2 running · 1 done". */
export const subagentsSummary = (infos: readonly SubagentInfo[]): string => {
    const count = (state: SubagentState): number => infos.filter(i => i.state === state).length;
    const parts = [
        count('running') ? `${count('running')} running` : '',
        count('review') ? `${count('review')} to review` : '',
        count('done') ? `${count('done')} done` : '',
        count('error') ? `${count('error')} need attention` : '',
        count('stopped') ? `${count('stopped')} stopped` : ''
    ].filter(Boolean);
    return parts.join(' · ');
};

export const subagentsView = (value: unknown): SubagentsView => SUBAGENT_VIEWS.includes(value as SubagentsView) ? value as SubagentsView : 'strip';
