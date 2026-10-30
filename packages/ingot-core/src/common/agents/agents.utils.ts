import { ACTIVE_STATUSES, FILE_BADGE_LABELS, MAX_TITLE_LENGTH, STATUS_LABELS } from './agents.consts';
import type { AgentSession, AgentStep } from './agents.types';

const SECOND_MS = 1_000;
const MINUTE = 60_000;
const HOUR = 60 * MINUTE;
const MINUTE_SECONDS = MINUTE / SECOND_MS;

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
    if (session.ask) {
        return 'Waiting for an answer';
    }
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

/** Generation used when a run starts without send() (a subagent or a Zaprex piece). */
export const CHILD_LOOP_GENERATION = 0;

/**
 * The generation a model loop should run as. send() stores one before it starts; a child run has none yet,
 * and treating that as "replaced" drops the loop before the first request.
 */
export const resolveLoopGeneration = (current: number | undefined): number => current ?? CHILD_LOOP_GENERATION;

export const titleFromPrompt = (prompt: string): string => {
    const text = prompt.trim().replace(/\s+/g, ' ');
    const title = text.charAt(0).toUpperCase() + text.slice(1);
    return title.length > MAX_TITLE_LENGTH ? `${title.slice(0, MAX_TITLE_LENGTH - 1)}…` : title;
};

export const stepVerb = (step: AgentStep): string => ({ read: 'Read', edit: 'Edit', run: 'Run', search: 'Search' })[step.kind];

export const stepText = (step: AgentStep): string => step.label ?? `${stepVerb(step)} ${step.target}`;

export const changesSummary = (count: number): string => `${count} ${count === 1 ? 'file' : 'files'} changed`;

export const fileWord = (count: number): string => count === 1 ? 'file' : 'files';

/** "Edited 16 files" on the collapsible card. */
export const editedFilesLabel = (count: number): string => `Edited ${count} ${fileWord(count)}`;

/** Elapsed time under the agent name, such as "2m 14s". */
export const formatWorked = (elapsedMs: number): string => {
    const total = Math.max(0, Math.floor(elapsedMs / SECOND_MS));
    const minutes = Math.floor(total / MINUTE_SECONDS);
    const seconds = total % MINUTE_SECONDS;
    return minutes < 1 ? `${seconds}s` : `${minutes}m ${seconds}s`;
};

export type FileBadgeTone = keyof typeof FILE_BADGE_LABELS;

const BADGE_BY_EXT: Readonly<Record<string, FileBadgeTone>> = {
    ts: 'ts', tsx: 'tsx', js: 'js', jsx: 'jsx', json: 'json', html: 'html', htm: 'html', css: 'css', scss: 'css', md: 'md'
};

/** Colored file-type badge for an edited-file row or a context chip; a path ending in `/` is a folder. */
export const fileBadge = (name: string): { readonly label: string; readonly tone: FileBadgeTone } => {
    if (name.endsWith('/')) {
        return { label: FILE_BADGE_LABELS.dir, tone: 'dir' };
    }
    const ext = name.includes('.') ? name.slice(name.lastIndexOf('.') + 1).toLowerCase() : '';
    const tone = BADGE_BY_EXT[ext] ?? 'file';
    return { label: FILE_BADGE_LABELS[tone], tone };
};
