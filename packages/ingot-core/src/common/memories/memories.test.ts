import { describe, expect, it } from 'vitest';
import { extractMemories, formatMemories, isMemoryId, newMemoryId, parseMemory, relevantMemories, serializeMemory, type Memory } from './memories';

const mem = (id: string, text: string, createdAt = 0): Memory => ({ id, scope: 'project', text, createdAt });

describe('memories (IDEA-77)', () => {
    it('serializes and parses with frontmatter', () => {
        const m: Memory = { id: 'm-abc', scope: 'global', text: 'Use pnpm, not npm.', createdAt: Date.UTC(2026, 9, 24) };
        expect(parseMemory('m-abc', 'global', serializeMemory(m))).toEqual(m);
        expect(parseMemory('m-x', 'project', 'plain text memory')?.text).toBe('plain text memory');
        expect(parseMemory('../evil', 'project', 'x')).toBeUndefined();
        expect(parseMemory('m-x', 'project', '---\nscope: project\n---\n')).toBeUndefined();
    });
    it('makes safe ids', () => {
        expect(isMemoryId(newMemoryId())).toBe(true);
        expect(isMemoryId('a/b')).toBe(false);
    });
    it('extracts REMEMBER lines from a reply', () => {
        const out = extractMemories('Done.\nREMEMBER: Tests use vitest.\nremember:   API base is /api/v2\nBye');
        expect(out.memories).toEqual(['Tests use vitest.', 'API base is /api/v2']);
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
});
