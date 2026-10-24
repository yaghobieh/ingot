import type { AgentSession } from './agents.types';
import { isAgentMode } from './agent-modes';

export const CHATS_STORAGE_KEY = 'ingot.chats.v1';
export const MAX_STORED_CHATS = 100;

/** History order: pinned first, then most recent. */
export const sortChats = (chats: readonly AgentSession[]): AgentSession[] =>
    [...chats].sort((a, b) => Number(!!b.pinned) - Number(!!a.pinned) || b.updatedAt - a.updatedAt);

export const filterChats = (chats: readonly AgentSession[], query: string): AgentSession[] => {
    const q = query.trim().toLowerCase();
    return sortChats(q ? chats.filter(c => c.title.toLowerCase().includes(q) || c.messages.some(m => m.text.toLowerCase().includes(q))) : chats);
};

/** Chats to persist: transient run state is dropped, the newest MAX_STORED_CHATS (pinned always) are kept. */
export const serializeChats = (chats: readonly AgentSession[]): string => {
    const sorted = sortChats(chats).filter(c => c.messages.length || c.pinned);
    return JSON.stringify(sorted.slice(0, MAX_STORED_CHATS).map(c => ({
        ...c, status: c.status === 'thinking' || c.status === 'editing' || c.status === 'review' ? 'idle' : c.status, activeFile: undefined
    })));
};

export const parseChats = (json: string | null | undefined): AgentSession[] => {
    if (!json) {
        return [];
    }
    try {
        const value: unknown = JSON.parse(json);
        if (!Array.isArray(value)) {
            return [];
        }
        return value.filter((c): c is AgentSession =>
            !!c && typeof c.id === 'string' && typeof c.title === 'string' && Array.isArray(c.messages) && isAgentMode(c.mode)
        ).map(c => ({ ...c, plan: c.plan ?? [], steps: c.steps ?? [], changes: c.changes ?? [] }));
    } catch {
        return [];
    }
};

export const chatTime = (updatedAt: number, now: number): string => {
    const minutes = Math.floor((now - updatedAt) / 60_000);
    if (minutes < 1) { return 'now'; }
    if (minutes < 60) { return `${minutes}m`; }
    const hours = Math.floor(minutes / 60);
    if (hours < 24) { return `${hours}h`; }
    return `${Math.floor(hours / 24)}d`;
};

const ago = (updatedAt: number, now: number): string => {
    const t = chatTime(updatedAt, now);
    if (t === 'now') { return 'just now'; }
    const n = parseInt(t, 10);
    const unit = t.endsWith('m') ? 'min' : t.endsWith('h') ? (n === 1 ? 'hour' : 'hours') : (n === 1 ? 'day' : 'days');
    return `${n} ${unit} ago`;
};

const baseName = (path: string): string => path.split('/').pop() ?? path;

/** Agent list subtitle per reference: 'Editing useCart.ts · 2m', 'Ready for review · 4 files', 'Done · 18 min ago'. */
export const agentSubtitle = (s: Pick<AgentSession, 'status' | 'updatedAt' | 'activeFile' | 'changes' | 'messages'>, now: number, reviewFiles = 0): string => {
    const files = reviewFiles || s.changes.length;
    switch (s.status) {
        case 'thinking': return `Thinking · ${chatTime(s.updatedAt, now)}`;
        case 'editing': return s.activeFile ? `Editing ${baseName(s.activeFile)} · ${chatTime(s.updatedAt, now)}` : `Editing · ${chatTime(s.updatedAt, now)}`;
        case 'review': return `Ready for review · ${files} file${files === 1 ? '' : 's'}`;
        case 'done': return `Done · ${ago(s.updatedAt, now)}`;
        case 'error': return `Failed · ${ago(s.updatedAt, now)}`;
        default: return s.messages.length ? `Idle · ${ago(s.updatedAt, now)}` : 'New chat';
    }
};
