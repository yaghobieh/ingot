import { describe, expect, it } from 'vitest';
import { mergeWindowChats, windowChats } from './chat-history';
import type { AgentSession } from './agents.types';

const A = 'file:///projects/alloy';
const B = 'file:///projects/forge';
const chat = (id: string, workspace?: string): AgentSession => ({
    id, title: id, status: 'idle', updatedAt: 0, mode: 'agent', model: 'auto', messages: [{ role: 'user', text: id }], plan: [], steps: [], changes: [], open: true, workspace
});
const ids = (chats: readonly AgentSession[]): string[] => chats.map(c => c.id);

describe('IDEA-266 windowChats', () => {
    it('a window without a folder starts with no chats', () => {
        expect(windowChats([chat('a', A), chat('legacy')], undefined)).toEqual([]);
    });

    it('a window shows only its workspace chats, not the previous window chats', () => {
        expect(ids(windowChats([chat('a', A), chat('b', B)], B))).toEqual(['b']);
    });

    it('chats saved before workspaces move into the window that loads them', () => {
        const loaded = windowChats([chat('legacy')], A);
        expect(loaded).toHaveLength(1);
        expect(loaded[0].workspace).toBe(A);
    });
});

describe('IDEA-266 mergeWindowChats', () => {
    it('keeps the other windows chats and writes this window chats with its workspace', () => {
        const merged = mergeWindowChats([chat('a', A), chat('b', B)], [chat('b', B), chat('new')], B);
        expect(ids(merged).sort()).toEqual(['a', 'b', 'new']);
        expect(merged.find(c => c.id === 'new')?.workspace).toBe(B);
    });

    it('a chat deleted in this window stays deleted', () => {
        expect(ids(mergeWindowChats([chat('a', A), chat('gone', B), chat('legacy')], [], B))).toEqual(['a']);
    });

    it('this window copy wins over the stored one', () => {
        const mine = { ...chat('b', B), title: 'renamed' };
        expect(mergeWindowChats([chat('b', B)], [mine], B)).toEqual([mine]);
    });
});
