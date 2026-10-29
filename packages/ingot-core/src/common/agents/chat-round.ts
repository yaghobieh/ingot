import type { AgentMessage, AgentStatus, AgentStep } from './agents.types';
import { ASK_USER_TOOL, REACTION_KINDS, THINKING_LABEL, THOUGHT_FOR_PREFIX, THOUGHT_LABEL, THOUGHT_SECOND_MS } from './chat-round.consts';
import type { EditConflict, ReactionKind, TabRunState, ThoughtStamp, TurnActivity, TurnCommand, TurnCommit, TurnFile } from './chat-round.types';
import { extractThought } from './tool-cards';

export const thoughtLabel = (thinking: boolean, durationMs?: number): string => {
    if (thinking) {
        return THINKING_LABEL;
    }
    if (durationMs === undefined) {
        return THOUGHT_LABEL;
    }
    const seconds = Math.max(1, Math.round(durationMs / THOUGHT_SECOND_MS));
    return `${THOUGHT_FOR_PREFIX}${seconds}s`;
};

/** Remember when a `<think>` block opened, and how long it lasted once it closes. */
export const stampThought = (previous: ThoughtStamp | undefined, text: string, now: number): ThoughtStamp => {
    const extracted = extractThought(text);
    if (extracted.thought === undefined) {
        return {};
    }
    const thoughtStarted = previous?.thoughtStarted ?? now;
    if (extracted.thinking) {
        return { thoughtStarted };
    }
    return { thoughtStarted, thoughtMs: previous?.thoughtMs ?? now - thoughtStarted };
};

export const toggleReaction = (current: readonly ReactionKind[] | undefined, kind: ReactionKind): ReactionKind[] => {
    const list = (current ?? []).filter(item => REACTION_KINDS.includes(item));
    return list.includes(kind) ? list.filter(item => item !== kind) : [...list, kind];
};

const argText = (value: unknown): string => typeof value === 'string' ? value.trim() : '';

const lastVisibleUser = (messages: readonly AgentMessage[]): number => {
    let start = 0;
    messages.forEach((message, index) => {
        if (message.role === 'user' && !message.hidden) {
            start = index;
        }
    });
    return start;
};

/** Files, commands and commits from the latest user turn. */
export const turnActivity = (messages: readonly AgentMessage[], steps: readonly AgentStep[]): TurnActivity => {
    const start = lastVisibleUser(messages);
    const commands: TurnCommand[] = [];
    const commits: TurnCommit[] = [];
    messages.slice(start).forEach((message, offset) => {
        const tool = message.tool;
        if (message.role !== 'tool' || !tool || tool.tool === ASK_USER_TOOL) {
            return;
        }
        const messageIndex = start + offset;
        if (tool.tool === 'run' || tool.tool === 'run_script') {
            const command = argText(tool.args.command) || argText(tool.args.script);
            if (command) {
                commands.push({ command, messageIndex });
            }
        }
        if (tool.tool === 'git' && tool.args.op === 'commit' && tool.state === 'done') {
            const subject = argText(tool.args.message).split('\n')[0] || 'commit';
            commits.push({ subject, messageIndex });
        }
    });
    const files: TurnFile[] = [];
    for (const step of steps) {
        if (step.kind !== 'edit') {
            continue;
        }
        const existing = files.findIndex(file => file.path === step.target);
        const next = { path: step.target, added: step.added ?? 0, removed: step.removed ?? 0 };
        if (existing >= 0) {
            files[existing] = next;
        } else {
            files.push(next);
        }
    }
    return { files, commands, commits };
};

export const hasTurnActivity = (activity: TurnActivity): boolean =>
    activity.files.length > 0 || activity.commands.length > 0 || activity.commits.length > 0;

/** Paths edited by more than one session. */
export const editConflicts = (sessions: readonly { id: string; paths: readonly string[] }[]): EditConflict[] => {
    const owners = new Map<string, string[]>();
    for (const session of sessions) {
        for (const path of new Set(session.paths)) {
            const ids = owners.get(path) ?? [];
            ids.push(session.id);
            owners.set(path, ids);
        }
    }
    return [...owners.entries()].filter(([, ids]) => ids.length > 1).map(([path, ids]) => ({ path, ids }));
};

export const conflictWarning = (titles: readonly string[], path: string): string =>
    `Conflict: ${(titles.length ? titles : ['Another agent']).join(', ')} also changed ${path}.`;

const RUNNING_STATUS: readonly AgentStatus[] = ['thinking', 'editing', 'approval'];

export const tabRunState = (running: boolean, waiting: boolean, hasMessages: boolean, status: AgentStatus): TabRunState => {
    if (waiting) {
        return 'waiting';
    }
    if (running || RUNNING_STATUS.includes(status)) {
        return 'running';
    }
    if (hasMessages && (status === 'idle' || status === 'done' || status === 'review' || status === 'error')) {
        return 'done';
    }
    return 'idle';
};
