import { describe, expect, it } from 'vitest';
import { AGENT_MODE_INFO, isAgentMode, modeInfo, nextMode } from './agent-modes';
import { agentSubtitle, CHATS_STORAGE_KEY, chatTime, filterChats, parseChats, serializeChats, sortChats } from './chat-history';
import { CONTEXT_NEAR_FULL, contextUsage, estimateTokens, formatTokens, usageBreakdown, usageRatio } from './context-usage';
import type { AgentSession } from './agents.types';

const chat = (id: string, patch: Partial<AgentSession> = {}): AgentSession => ({
    id, title: id, status: 'idle', updatedAt: 0, mode: 'agent', model: 'gpt-5', messages: [{ role: 'user', text: `hello ${id}` }], plan: [], steps: [], changes: [], ...patch
});

describe('chat modes (IDEA-77)', () => {
    it('has six modes with permissions', () => {
        expect(AGENT_MODE_INFO.map(m => m.id)).toEqual(['agent', 'multi', 'ask', 'plan', 'debug', 'research']);
        expect(modeInfo('research')).toMatchObject({ label: 'Deep research', canEdit: false, canUseTools: false, beta: true });
        expect(modeInfo('ask').canEdit).toBe(false);
        expect(modeInfo('ask').canUseTools).toBe(false);
        expect(modeInfo('plan').canEdit).toBe(false);
        expect(modeInfo('agent').canEdit).toBe(true);
    });
    it('cycles forward and wraps', () => {
        expect(nextMode('agent')).toBe('multi');
        expect(nextMode('debug')).toBe('research');
        expect(nextMode('research')).toBe('agent');
        expect(nextMode('agent', -1)).toBe('research');
        expect(isAgentMode('plan')).toBe(true);
        expect(isAgentMode('nope')).toBe(false);
    });
});

describe('chat history', () => {
    it('sorts pinned first, then newest', () => {
        const list = sortChats([chat('a', { updatedAt: 3 }), chat('b', { updatedAt: 5 }), chat('c', { updatedAt: 1, pinned: true })]);
        expect(list.map(c => c.id)).toEqual(['c', 'b', 'a']);
    });
    it('searches titles and messages', () => {
        expect(filterChats([chat('cart'), chat('auth', { messages: [{ role: 'user', text: 'fix the CART bug' }] }), chat('x')], 'cart').map(c => c.id).sort()).toEqual(['auth', 'cart']);
    });
    it('round-trips, drops empty chats and resets running state', () => {
        const json = serializeChats([chat('a', { status: 'thinking', activeFile: 'x.ts', open: true }), chat('empty', { messages: [] })]);
        const back = parseChats(json);
        expect(back.map(c => c.id)).toEqual(['a']);
        expect(back[0].status).toBe('idle');
        expect(back[0].activeFile).toBeUndefined();
        expect(back[0].open).toBe(true);
        const kept = parseChats(serializeChats([chat('react', {
            ask: { question: 'Which name?' },
            messages: [{ role: 'user', text: 'hello', reactions: ['like'] }, { role: 'agent', text: '<think>a</think>b', thoughtMs: 1000, thoughtStarted: 5 }]
        })]));
        expect(kept[0].ask).toBeUndefined();
        expect(kept[0].messages[0].reactions).toEqual(['like']);
        expect(kept[0].messages[1].thoughtMs).toBe(1000);
        expect(kept[0].messages[1].thoughtStarted).toBeUndefined();
        expect(parseChats('not json')).toEqual([]);
        expect(parseChats(JSON.stringify([{ id: 1 }]))).toEqual([]);
        expect(CHATS_STORAGE_KEY).toMatch(/^ingot\./);
    });
    it('formats relative times', () => {
        expect(chatTime(0, 30_000)).toBe('now');
        expect(chatTime(0, 5 * 60_000)).toBe('5m');
        expect(chatTime(0, 3 * 3600_000)).toBe('3h');
        expect(chatTime(0, 50 * 3600_000)).toBe('2d');
    });
});

describe('context usage', () => {
    it('estimates and sums tokens', () => {
        expect(estimateTokens('abcdefgh')).toBe(2);
        const u = contextUsage({ system: 100, rules: 50, files: 800, memories: 25, history: 25 }, 1000);
        expect(u.total).toBe(1000);
        expect(usageRatio(u)).toBe(1);
        expect(usageRatio(undefined)).toBe(0);
        expect(usageRatio(contextUsage({ system: 0, rules: 0, files: 0, memories: 0, history: 900 }, 1000)) >= CONTEXT_NEAR_FULL).toBe(true);
        expect(usageBreakdown(u)).toContain('Files: 800');
    });
    it('formats token counts', () => {
        expect(formatTokens(950)).toBe('950');
        expect(formatTokens(12_340)).toBe('12.3k');
        expect(formatTokens(200_000)).toBe('200k');
        expect(formatTokens(1_000_000)).toBe('1M');
    });
});

describe('agentSubtitle (chat v2 agent list)', () => {
    const base = { updatedAt: 0, activeFile: undefined as string | undefined, changes: [] as AgentSession['changes'], messages: [] as AgentSession['messages'] };
    const now = 2 * 60_000;
    it('follows the reference wording', () => {
        expect(agentSubtitle({ ...base, status: 'editing', activeFile: 'src/hooks/useCart.ts' }, now)).toBe('Editing useCart.ts · 2m');
        expect(agentSubtitle({ ...base, status: 'review' }, now, 4)).toBe('Ready for review · 4 files');
        expect(agentSubtitle({ ...base, status: 'done' }, 18 * 60_000)).toBe('Done · 18 min ago');
        expect(agentSubtitle({ ...base, status: 'idle' }, now)).toBe('New chat');
    });
});
