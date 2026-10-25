import { describe, expect, it } from 'vitest';
import { pinnedFirst, reorderTabs, togglePinOrder, tabContextLevel, tabLabel, tabTitleFromText } from './chat-tabs';

describe('chat tabs (IDEA-98)', () => {
    it('never shows "New chat"; names a fresh chat from a few words of the draft', () => {
        expect(tabLabel('New chat')).toBe('');
        expect(tabLabel('New chat', 'fix the')).toBe('');
        expect(tabLabel('New chat', 'fix the cart total rounding bug please')).toBe('Fix the cart total rounding');
        expect(tabLabel('Renamed', 'anything')).toBe('Renamed');
    });

    it('builds short titles without chip labels', () => {
        expect(tabTitleFromText('[a.ts (3-5)] explain this function for me')).toBe('Explain this function for me');
        expect(tabTitleFromText('supercalifragilisticexpialidocious '.repeat(3)).length).toBeLessThanOrEqual(32);
    });

    it('colors the context meter', () => {
        expect(tabContextLevel(0.5)).toBe('ok');
        expect(tabContextLevel(0.85)).toBe('warn');
        expect(tabContextLevel(0.96)).toBe('full');
    });

    it('reorders by drag and keeps pinned tabs first', () => {
        expect(reorderTabs(['a', 'b', 'c'], 'a', 'c')).toEqual(['b', 'c', 'a']);
        expect(reorderTabs(['a', 'b', 'c'], 'c', 'a')).toEqual(['c', 'a', 'b']);
        expect(reorderTabs(['p', 'a', 'b'], 'b', 'p', new Set(['p']))).toEqual(['p', 'b', 'a']);
        expect(pinnedFirst(['a', 'p', 'b'], new Set(['p']))).toEqual(['p', 'a', 'b']);
    });
});

describe('togglePinOrder (IDEA-104)', () => {
    it('pins to the end of the pinned group, in pin order', () => {
        expect(togglePinOrder(['a', 'b', 'c', 'd'], new Set(), 'c')).toEqual(['c', 'a', 'b', 'd']);
        expect(togglePinOrder(['c', 'a', 'b', 'd'], new Set(['c']), 'd')).toEqual(['c', 'd', 'a', 'b']);
        expect(togglePinOrder(['c', 'd', 'a', 'b'], new Set(['c', 'd']), 'a')).toEqual(['c', 'd', 'a', 'b']);
    });
    it('unpins to the first unpinned slot', () => {
        expect(togglePinOrder(['c', 'd', 'a', 'b'], new Set(['c', 'd']), 'c')).toEqual(['d', 'c', 'a', 'b']);
        expect(togglePinOrder(['c', 'd', 'a', 'b'], new Set(['c', 'd', 'a']), 'd')).toEqual(['c', 'a', 'd', 'b']);
    });
    it('ignores an unknown id', () => {
        expect(togglePinOrder(['a', 'b'], new Set(), 'x')).toEqual(['a', 'b']);
    });
});
