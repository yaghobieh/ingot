import { describe, expect, it } from 'vitest';
import { formatContextFiles, parseAgentOutput, parseMentions } from './agent-protocol';

const OUTPUT = [
    'PLAN:',
    '- Read math.ts',
    '- Add subtract',
    '',
    'Adding `subtract`.',
    '<<<EDIT src/math.ts',
    'export const add = (a: number, b: number) => a + b;',
    'export const subtract = (a: number, b: number) => a - b;',
    '>>>END',
    'Done.'
].join('\n');

describe('agent protocol', () => {
    it('extracts plan, edits and display text', () => {
        const parsed = parseAgentOutput(OUTPUT);
        expect(parsed.plan).toEqual(['Read math.ts', 'Add subtract']);
        expect(parsed.edits).toEqual([{ path: 'src/math.ts', content: 'export const add = (a: number, b: number) => a + b;\nexport const subtract = (a: number, b: number) => a - b;\n' }]);
        expect(parsed.display).toBe('Adding `subtract`.\n\nDone.');
        expect(parsed.editing).toBeUndefined();
    });

    it('reports an edit that is still streaming', () => {
        const partial = parseAgentOutput('Working on it\n<<<EDIT src/a.ts\nconst x = 1;');
        expect(partial.edits).toEqual([]);
        expect(partial.editing).toBe('src/a.ts');
        expect(partial.display).toBe('Working on it');
        expect(parseAgentOutput('x <<<EDIT src/b').editing).toBe('src/b');
    });

    it('parses multiple edits', () => {
        const parsed = parseAgentOutput('<<<EDIT a.ts\n1\n>>>END\n<<<EDIT b.ts\n2\n>>>END');
        expect(parsed.edits.map(e => e.path)).toEqual(['a.ts', 'b.ts']);
    });

    it('finds @file mentions and formats context with a budget', () => {
        expect(parseMentions('fix @src/math.ts and @README.md, not me@x')).toEqual(['src/math.ts', 'README.md']);
        expect(formatContextFiles([{ path: 'a.ts', content: 'abcdef' }], 3)).toBe('File: a.ts\n```\nabc\n… (truncated)\n```');
    });
});
