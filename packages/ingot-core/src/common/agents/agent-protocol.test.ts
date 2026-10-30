import { describe, expect, it } from 'vitest';
import { formatContextFiles, normalizeToolCalls, parseAgentOutput, parseMentions, toolProtocol } from './agent-protocol';

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

    it('parses tool calls and describes tools', () => {
        const parsed = parseAgentOutput('Let me add.\n<<<TOOL calc/add\n{"a": 2, "b": 3}\n>>>END');
        expect(parsed.toolCalls).toEqual([{ server: 'calc', tool: 'add', args: { a: 2, b: 3 } }]);
        expect(parsed.display).toBe('Let me add.');
        expect(parseAgentOutput('<<<TOOL calc/add\nnot json\n>>>END').toolCalls[0].args).toEqual({});
        expect(toolProtocol([{ server: 'calc', name: 'add', description: 'Adds' }])).toContain('- calc/add: Adds');
        expect(toolProtocol([])).toBe('');
    });
});

describe('native tool-call format (IDEA-250)', () => {
    const reply = [
        "I'll explore the project.",
        '',
        '<function_calls> <invoke name="ingot/list_dir"> <parameter name="path">.</parameter> <parameter name="depth">2</parameter> </invoke>',
        '<invoke name="read_file"> <parameter name="path">README.md</parameter> </invoke> </function_calls>'
    ].join('\n');

    it('runs invoke blocks as tool calls instead of printing them', () => {
        const parsed = parseAgentOutput(reply);
        expect(parsed.toolCalls).toEqual([
            { server: 'ingot', tool: 'list_dir', args: { path: '.', depth: 2 } },
            { server: 'ingot', tool: 'read_file', args: { path: 'README.md' } }
        ]);
        expect(parsed.display).toBe("I'll explore the project.");
    });

    it('hides a call that is still streaming', () => {
        const parsed = parseAgentOutput('Looking.\n<function_calls> <invoke name="ingot/read_file"> <parameter name="pa');
        expect(parsed.display).toBe('Looking.');
        expect(parsed.toolCalls).toEqual([]);
        expect(normalizeToolCalls('No tools here.')).toBe('No tools here.');
    });

    it('runs tool_call JSON, fenced JSON and a line-start ingot tool, and leaves other JSON alone', () => {
        const json = parseAgentOutput('<tool_call>\n{"name":"read_file","arguments":{"path":"src/a.ts"}}\n</tool_call>');
        expect(json.toolCalls).toEqual([{ server: 'ingot', tool: 'read_file', args: { path: 'src/a.ts' } }]);
        const fenced = parseAgentOutput('```tool\n{"name":"ingot/grep","arguments":{"pattern":"rank"}}\n```');
        expect(fenced.toolCalls).toEqual([{ server: 'ingot', tool: 'grep', args: { pattern: 'rank' } }]);
        const inline = parseAgentOutput('ingot/read_file {"path":"README.md"}');
        expect(inline.toolCalls).toEqual([{ server: 'ingot', tool: 'read_file', args: { path: 'README.md' } }]);
        const plain = parseAgentOutput('```json\n{"hello":1}\n```');
        expect(plain.toolCalls).toEqual([]);
        expect(plain.display).toContain('"hello":1');
        const streaming = parseAgentOutput('Looking.\n<tool_call>\n{"name":"ingot/read_file"');
        expect(streaming.display).toBe('Looking.');
        expect(streaming.toolCalls).toEqual([]);
        const openFence = parseAgentOutput('Looking.\n```json\n{"name":"ingot/read_file","arguments":{"path":"a.ts"}}');
        expect(openFence.display).toBe('Looking.');
        expect(openFence.toolCalls).toEqual([]);
    });
});
