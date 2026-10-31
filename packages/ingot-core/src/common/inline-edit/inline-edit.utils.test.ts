import { describe, expect, it } from 'vitest';
import { buildInlineEditMessages, cleanReply, replaceSpan, selectionLineSpan, splitAroundSpan } from './inline-edit.utils';
import { INLINE_EDIT_SYSTEM_MARKER } from './inline-edit.consts';

const FILE = ['a', 'b', 'c', 'd', 'e'].join('\n');

describe('inline edit', () => {
    it('expands a selection to whole lines', () => {
        expect(selectionLineSpan({ startLineNumber: 2, endLineNumber: 3, endColumn: 4 })).toEqual({ startLine: 2, endLine: 3 });
        expect(selectionLineSpan({ startLineNumber: 2, endLineNumber: 4, endColumn: 1 })).toEqual({ startLine: 2, endLine: 3 });
        expect(selectionLineSpan({ startLineNumber: 2, endLineNumber: 2, endColumn: 1 })).toEqual({ startLine: 2, endLine: 2 });
    });

    it('splits the selection from its context', () => {
        expect(splitAroundSpan(FILE, { startLine: 3, endLine: 3 }, 1)).toEqual({ before: 'b', selection: 'c', after: 'd' });
        expect(splitAroundSpan(FILE, { startLine: 1, endLine: 2 }, 10)).toEqual({ before: '', selection: 'a\nb', after: 'c\nd\ne' });
    });

    it('replaces the span and keeps the line endings', () => {
        expect(replaceSpan(FILE, { startLine: 2, endLine: 3 }, 'X\nY\nZ')).toBe('a\nX\nY\nZ\nd\ne');
        expect(replaceSpan('a\r\nb\r\nc', { startLine: 2, endLine: 2 }, 'B')).toBe('a\r\nB\r\nc');
        expect(replaceSpan(`${FILE}\n`, { startLine: 5, endLine: 5 }, 'E')).toBe('a\nb\nc\nd\nE\n');
    });

    it('cleans fences and blank lines from a reply', () => {
        expect(cleanReply('```ts\n    return a + b;\n```\n')).toBe('    return a + b;');
        expect(cleanReply('\n\n  x();\n\n')).toBe('  x();');
        expect(cleanReply('```\nconst a = 1;\nconst b = 2;')).toBe('const a = 1;\nconst b = 2;');
    });

    it('sends the instruction, selection and context', () => {
        const [system, user] = buildInlineEditMessages({ path: 'src/a.ts', languageId: 'typescript', instruction: 'rename x', before: 'top', selection: 'let x;', after: 'bottom' });
        expect(system.role).toBe('system');
        expect(system.content.startsWith(INLINE_EDIT_SYSTEM_MARKER)).toBe(true);
        expect(user.content).toContain('INSTRUCTION: rename x');
        expect(user.content).toContain('<<<SELECTED CODE\nlet x;\nSELECTED CODE>>>');
        expect(user.content).toContain('FILE: src/a.ts (typescript)');
    });
});
