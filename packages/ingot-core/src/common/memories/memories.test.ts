import { describe, expect, it } from 'vitest';
import { extractMemories, formatMemories, isMemoryId, newMemoryId, parseMemory, relevantMemories, serializeMemory, type Memory } from './memories';

const mem = (id: string, text: string, createdAt = 0, kind: Memory['kind'] = 'fact'): Memory => ({ id, scope: 'project', kind, text, createdAt });

describe('memories (IDEA-77)', () => {
    it('serializes and parses with frontmatter', () => {
        const m: Memory = { id: 'm-abc', scope: 'global', kind: 'preference', text: 'Use pnpm, not npm.', createdAt: Date.UTC(2026, 9, 24) };
        expect(parseMemory('m-abc', 'global', serializeMemory(m))).toEqual(m);
        expect(parseMemory('m-x', 'project', 'plain text memory')?.text).toBe('plain text memory');
        expect(parseMemory('../evil', 'project', 'x')).toBeUndefined();
        expect(parseMemory('m-x', 'project', '---\nscope: project\n---\n')).toBeUndefined();
    });
    it('reads IDEA-77 files without a kind as repo facts', () => {
        expect(parseMemory('m-old', 'project', '---\nscope: project\ncreated: 2026-01-01T00:00:00.000Z\n---\nTests use vitest.\n')?.kind).toBe('fact');
        expect(parseMemory('m-odd', 'project', '---\nkind: banana\n---\nx\n')?.kind).toBe('fact');
    });
    it('makes safe ids', () => {
        expect(isMemoryId(newMemoryId())).toBe(true);
        expect(isMemoryId('a/b')).toBe(false);
    });
    it('extracts REMEMBER and PREFERENCE lines from a reply', () => {
        const out = extractMemories('Done.\nREMEMBER: Tests use vitest.\nremember:   API base is /api/v2\nPreference: Answer in British English.\nPREFERENCE:\nBye');
        expect(out.memories).toEqual([
            { kind: 'fact', text: 'Tests use vitest.' },
            { kind: 'fact', text: 'API base is /api/v2' },
            { kind: 'preference', text: 'Answer in British English.' }
        ]);
        expect(out.display).toBe('Done.\nBye');
    });
    it('injects all memories when few, otherwise the relevant ones', () => {
        const few = [mem('a', 'one'), mem('b', 'two')];
        expect(relevantMemories(few, 'anything')).toHaveLength(2);
        const many = Array.from({ length: 10 }, (_, i) => mem(`m${i}`, i === 7 ? 'The cart store uses zustand' : `unrelated fact ${i}`));
        expect(relevantMemories(many, 'fix the cart store').map(m => m.id)).toEqual(['m7']);
        expect(formatMemories(few)).toContain('- one');
        expect(formatMemories([])).toBe('');
    });
    it('always injects preferences and labels both sections', () => {
        const facts = Array.from({ length: 10 }, (_, i) => mem(`f${i}`, `unrelated fact ${i}`));
        const pref = mem('p1', 'Keep replies short', 0, 'preference');
        const picked = relevantMemories([pref, ...facts], 'rename the cart');
        expect(picked.map(m => m.id)).toEqual(['p1']);
        const text = formatMemories([pref, facts[0]]);
        expect(text).toContain('Repo facts remembered from earlier chats:\n- unrelated fact 0');
        expect(text).toContain('User preferences (follow them):\n- Keep replies short');
    });
});
