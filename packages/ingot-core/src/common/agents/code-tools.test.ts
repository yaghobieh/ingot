import { describe, expect, it } from 'vitest';
import {
    applyTextEdits, codeToolDetail, codeToolStep, findSymbolPosition, formatDiagnostics, formatLocations, isCodeEditTool, isCodeTool, parseNewName, parseSymbolTarget, severityFilter, severityOf
} from './code-tools';
import type { CodeDiagnostic, CodeLocation } from './code-tools.types';
import { stepText } from './agents.utils';

const SOURCE = [
    "import { add } from './math';",
    '',
    'const total = add(1, 2);',
    'export const addAll = (xs: number[]) => xs.reduce(add, 0);',
    'console.log(total, add);'
].join('\n');

const loc = (path: string, line: number, column: number, preview = 'x'): CodeLocation =>
    ({ path, range: { startLine: line, startColumn: column, endLine: line, endColumn: column + 1 }, preview });

describe('code tools (IDEA-259)', () => {
    it('knows its tools and which ones edit', () => {
        expect(isCodeTool('find_references')).toBe(true);
        expect(isCodeTool('read_file')).toBe(false);
        expect(isCodeEditTool('rename_symbol')).toBe(true);
        expect(isCodeEditTool('diagnostics')).toBe(false);
    });

    it('reads a symbol target and refuses one without a path or a position', () => {
        expect(parseSymbolTarget({ path: 'src/a.ts', symbol: 'add', line: '3' })).toEqual({ path: 'src/a.ts', symbol: 'add', line: 3 });
        expect(parseSymbolTarget({ file: 'a.ts', line: 2, character: 5 })).toEqual({ path: 'a.ts', line: 2, column: 5 });
        expect(parseSymbolTarget({ symbol: 'add' })).toHaveProperty('error');
        expect(parseSymbolTarget({ path: 'a.ts', line: 0 })).toHaveProperty('error');
    });

    it('validates the new name', () => {
        expect(parseNewName({ new_name: 'sum' })).toBe('sum');
        expect(parseNewName({ newName: '$el' })).toBe('$el');
        expect(parseNewName({ new_name: '2fast' })).toHaveProperty('error');
        expect(parseNewName({})).toHaveProperty('error');
    });

    it('finds a symbol as a whole word, nearest to the given line', () => {
        expect(findSymbolPosition(SOURCE, { path: 'a.ts', symbol: 'add' })).toEqual({ line: 1, column: 10 });
        expect(findSymbolPosition(SOURCE, { path: 'a.ts', symbol: 'add', line: 3 })).toEqual({ line: 3, column: 15 });
        // "addAll" is not "add"; line 4 still has "add" as a whole word later on.
        expect(findSymbolPosition(SOURCE, { path: 'a.ts', symbol: 'add', line: 4 })).toEqual({ line: 4, column: 51 });
        expect(findSymbolPosition(SOURCE, { path: 'a.ts', symbol: 'add', line: 2 })).toEqual({ line: 1, column: 10 });
        expect(findSymbolPosition(SOURCE, { path: 'a.ts', symbol: 'missing' })).toBeUndefined();
        expect(findSymbolPosition(SOURCE, { path: 'a.ts', line: 3, column: 99 })).toEqual({ line: 3, column: 25 });
        expect(findSymbolPosition(SOURCE, { path: 'a.ts', line: 40 })).toBeUndefined();
    });

    it('applies several edits against the original text', () => {
        const edits = [
            { range: { startLine: 1, startColumn: 10, endLine: 1, endColumn: 13 }, text: 'sum' },
            { range: { startLine: 3, startColumn: 15, endLine: 3, endColumn: 18 }, text: 'sum' },
            { range: { startLine: 5, startColumn: 20, endLine: 5, endColumn: 23 }, text: 'sum' }
        ];
        const out = applyTextEdits(SOURCE, edits).split('\n');
        expect(out[0]).toBe("import { sum } from './math';");
        expect(out[2]).toBe('const total = sum(1, 2);');
        expect(out[4]).toBe('console.log(total, sum);');
    });

    it('applies multi-line edits, inserts and skips an overlapping edit', () => {
        const text = 'a\nb\nc\n';
        expect(applyTextEdits(text, [{ range: { startLine: 1, startColumn: 1, endLine: 3, endColumn: 1 }, text: 'x\n' }])).toBe('x\nc\n');
        expect(applyTextEdits(text, [{ range: { startLine: 4, startColumn: 1, endLine: 4, endColumn: 1 }, text: 'd\n' }])).toBe('a\nb\nc\nd\n');
        expect(applyTextEdits(text, [
            { range: { startLine: 1, startColumn: 1, endLine: 2, endColumn: 2 }, text: 'X' },
            { range: { startLine: 2, startColumn: 1, endLine: 2, endColumn: 2 }, text: 'Y' }
        ])).toBe('a\nY\nc\n');
    });

    it('formats locations sorted, deduplicated and capped', () => {
        const text = formatLocations('references', [loc('src/b.ts', 4, 2, 'add(1)'), loc('src/a.ts', 9, 1), loc('src/b.ts', 4, 2, 'add(1)'), loc('src/a.ts', 2, 5)], 2);
        expect(text.split('\n')).toEqual(['3 references in 2 files:', 'src/a.ts:2:5  x', 'src/a.ts:9:1  x', '… 1 more']);
        expect(formatLocations('definitions', [loc('a.ts', 1, 1)])).toBe('1 definition in 1 file:\na.ts:1:1  x');
        expect(formatLocations('references', [])).toBe('No references found.');
    });

    it('maps LSP severities and filters by the wanted one', () => {
        expect(severityOf(1)).toBe('error');
        expect(severityOf(2)).toBe('warning');
        expect(severityOf(undefined)).toBe('error');
        expect(severityFilter('error')('warning')).toBe(false);
        expect(severityFilter('warning')('error')).toBe(true);
        expect(severityFilter(undefined)('hint')).toBe(true);
    });

    it('formats diagnostics errors first with counts', () => {
        const diags: CodeDiagnostic[] = [
            { path: 'src/a.ts', line: 3, column: 7, severity: 'warning', message: "'x' is declared but never used.", source: 'ts', code: '6133' },
            { path: 'src/b.ts', line: 1, column: 1, severity: 'error', message: 'Type \'string\'\n is not assignable.', source: 'ts', code: '2322' }
        ];
        expect(formatDiagnostics(diags, 'the project').split('\n')).toEqual([
            '1 error, 1 warning in the project:',
            "src/b.ts:1:1 error Type 'string' is not assignable. (ts 2322)",
            "src/a.ts:3:7 warning 'x' is declared but never used. (ts 6133)"
        ]);
        expect(formatDiagnostics([], 'src/a.ts')).toBe('No problems in src/a.ts.');
    });

    it('describes a call for the card', () => {
        expect(codeToolDetail('rename_symbol', { path: 'src/a.ts', symbol: 'add', new_name: 'sum' })).toBe('add → sum · src/a.ts');
        expect(codeToolDetail('find_references', { path: 'src/a.ts', line: 3 })).toBe('line 3 · src/a.ts');
        expect(codeToolDetail('diagnostics', {})).toBe('whole project');
    });

    it('labels the checklist step', () => {
        expect(codeToolStep('find_references', { path: 'src/math.ts', symbol: 'add' })).toBe('Find references: add · src/math.ts');
        expect(codeToolStep('organize_imports', { path: 'src/main.ts' })).toBe('Organize imports: src/main.ts');
        expect(stepText({ kind: 'run', target: 'ingot/diagnostics', done: true, label: 'Check problems: whole project' })).toBe('Check problems: whole project');
        expect(stepText({ kind: 'read', target: 'a.ts', done: true })).toBe('Read a.ts');
    });
});
