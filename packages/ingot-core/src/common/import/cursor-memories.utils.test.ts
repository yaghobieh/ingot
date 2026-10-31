import { describe, expect, it } from 'vitest';
import {
    cursorMemoriesOffer, cursorMemoriesSignature, isCursorMemoryFile, newCursorMemories, parseCursorMemoriesJson, parseCursorMemoryFile
} from './cursor-memories.utils';
import type { CursorMemory } from './cursor-memories.types';

const fact = (text: string): CursorMemory => ({ text, scope: 'project', from: '.cursor/memories/a.md' });
const pref = (text: string): CursorMemory => ({ text, scope: 'global', from: '~/.cursor/memories.json' });

describe('IDEA-287 import Cursor memories', () => {
    it('reads Markdown memory files without frontmatter', () => {
        expect(isCursorMemoryFile('build.md')).toBe(true);
        expect(isCursorMemoryFile('NOTE.TXT')).toBe(true);
        expect(isCursorMemoryFile('image.png')).toBe(false);
        expect(parseCursorMemoryFile('---\ntitle: Build\n---\nUse pnpm to build.\n')).toBe('Use pnpm to build.');
        expect(parseCursorMemoryFile('  Plain memory\r\n')).toBe('Plain memory');
    });

    it('reads JSON exports as an array or under "memories", with any text field', () => {
        expect(parseCursorMemoriesJson('["One", " ", {"memory": "Two"}, {"content": "Three"}, {"title": "Four"}, 5, null]')).toEqual(['One', 'Two', 'Three', 'Four']);
        expect(parseCursorMemoriesJson('{"memories": [{"text": "Five"}]}')).toEqual(['Five']);
        expect(parseCursorMemoriesJson('{"other": []}')).toEqual([]);
        expect(parseCursorMemoriesJson('not json')).toEqual([]);
    });

    it('skips memories Ingot already has and duplicates, ignoring case and spacing', () => {
        const found = [fact('Use  pnpm.'), fact('use pnpm.'), pref('Answer briefly.'), fact('Tests live in e2e/.')];
        expect(newCursorMemories(found, [{ text: 'Tests live in e2e/.' }]).map(m => m.text)).toEqual(['Use  pnpm.', 'Answer briefly.']);
    });

    it('offers with a summary and a stable signature', () => {
        const list = [fact('A'), fact('B'), pref('C')];
        expect(cursorMemoriesOffer(list)).toBe('Found 3 Cursor memories (2 repo facts from .cursor and 1 preference from ~/.cursor). Import them into Ingot memory?');
        expect(cursorMemoriesOffer([fact('A')])).toBe('Found 1 Cursor memory (1 repo fact from .cursor). Import them into Ingot memory?');
        expect(cursorMemoriesSignature(list)).toBe(cursorMemoriesSignature([...list].reverse()));
        expect(cursorMemoriesSignature(list)).not.toBe(cursorMemoriesSignature([fact('A')]));
    });
});
