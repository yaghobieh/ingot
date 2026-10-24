import { ACTIVE_STATUSES, MAX_TITLE_LENGTH, STATUS_LABELS } from './agents.consts';
import type { AgentSession, AgentStep } from './agents.types';

const MINUTE = 60_000;
const HOUR = 60 * MINUTE;

export const relativeTime = (from: number, now: number): string => {
    const delta = Math.max(0, now - from);
    if (delta < MINUTE) {
        return 'just now';
    }
    if (delta < HOUR) {
        const m = Math.floor(delta / MINUTE);
        return m < 5 ? `${m}m` : `${m} min ago`;
    }
    return `${Math.floor(delta / HOUR)} h ago`;
};

/** List subtitle, e.g. "Editing useCart.ts · 2m", "Ready for review · 4 files", "Done · 18 min ago". */
export const agentSubtitle = (session: AgentSession, now: number): string => {
    const label = STATUS_LABELS[session.status];
    if (session.status === 'editing' && session.activeFile) {
        return `${label} ${session.activeFile} · ${relativeTime(session.updatedAt, now)}`;
    }
    if (session.status === 'review') {
        // Files proposed in this run (still under review or already kept).
        const files = new Set([...session.changes.map(c => c.label), ...session.steps.filter(st => st.kind === 'edit').map(st => st.target)]).size;
        return `${label} · ${files} ${files === 1 ? 'file' : 'files'}`;
    }
    return `${label} · ${relativeTime(session.updatedAt, now)}`;
};

export const activeAgentCount = (sessions: readonly AgentSession[]): number => sessions.filter(s => ACTIVE_STATUSES.includes(s.status)).length;

export const titleFromPrompt = (prompt: string): string => {
    const text = prompt.trim().replace(/\s+/g, ' ');
    const title = text.charAt(0).toUpperCase() + text.slice(1);
    return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
};

export const stepVerb = (step: AgentStep): string => ({ read: 'Read', edit: 'Edit', run: 'Run', search: 'Search' })[step.kind];

export const changesSummary = (count: number): string => `${count} ${count === 1 ? 'file' : 'files'} changed`;
