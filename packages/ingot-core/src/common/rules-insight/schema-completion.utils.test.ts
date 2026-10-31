import { describe, expect, it } from 'vitest';
import { frontmatterCompletions, globAt, globPreview, globPreviews, globSuggestions, isGlobSchema, jsonCompletions, valueSuggestions } from './schema-completion.utils';
import { schemaById } from '../rules-engine/schema-validate.utils';
import { RULE_SCHEMA } from '../rules-engine/schemas.consts';

const rule = schemaById('rule')!;
const mcp = schemaById('mcp')!;
const files = ['src/a.ts', 'src/b.ts', 'src/c.tsx', 'docs/readme.md', 'packages/web/src/app.tsx', '.ingot/rules/x.md'];

describe('schema completion', () => {
    it('offers the template in an empty file', () => {
        expect(frontmatterCompletions('', 0, 0, rule)).toEqual([expect.objectContaining({ kind: 'template', insertText: rule.template })]);
        expect(jsonCompletions('', 0, mcp)[0].kind).toBe('template');
    });

    it('offers missing frontmatter keys with their values', () => {
        const text = '---\ndescription: x\n\n---\nBody';
        const keys = frontmatterCompletions(text, 2, 0, rule);
        expect(keys.map(k => k.label)).toEqual(['globs', 'alwaysApply', 'pack']);
        expect(keys.find(k => k.label === 'alwaysApply')?.values).toEqual(['true', 'false']);
        expect(frontmatterCompletions(text, 5, 0, rule)).toEqual([]);
    });

    it('offers booleans after a key and project globs after globs:', () => {
        expect(frontmatterCompletions('---\nalwaysApply: \n---\n', 1, 13, rule).map(s => s.label)).toEqual(['true', 'false']);
        const globs = frontmatterCompletions('---\nglobs: \n---\n', 1, 7, rule, files);
        expect(globs[0]).toEqual({ label: '**/*.ts', kind: 'glob', insertText: '"**/*.ts"' });
        expect(globs.map(g => g.label)).toContain('src/**');
    });

    it('detects glob schemas and value suggestions', () => {
        expect(isGlobSchema(RULE_SCHEMA.properties!.globs)).toBe(true);
        expect(isGlobSchema(RULE_SCHEMA.properties!.description)).toBe(false);
        expect(valueSuggestions({ enum: ['a', 'b'] })).toEqual(['a', 'b']);
        expect(globSuggestions(files).slice(0, 2)).toEqual(['**/*.ts', '**/*.tsx']);
    });

    it('offers JSON keys at the right level', () => {
        expect(jsonCompletions('{\n  \n}', 4, mcp).map(s => s.label)).toEqual(['$schema', 'mcpServers']);
        expect(jsonCompletions('{ "mcpServers": {} }', 3, mcp).map(s => s.label)).toEqual(['$schema', 'mcpServers']);
        expect(jsonCompletions('{ "mcpServers": {}, "" }', 21, mcp).map(s => s.label)).toEqual(['$schema']);
        const server = '{ "mcpServers": { "db": { } } }';
        const labels = jsonCompletions(server, server.indexOf('{ }') + 1, mcp).map(s => s.label);
        expect(labels).toEqual(expect.arrayContaining(['command', 'args', 'url']));
    });

    it('previews what a glob matches, relative to a nested rule folder', () => {
        expect(globPreview('src/**/*.ts', '', files).matches).toEqual(['src/a.ts', 'src/b.ts']);
        expect(globPreview('src/**', 'packages/web', files).matches).toEqual(['packages/web/src/app.tsx']);
        expect(globPreview('nope/**', '', files).matches).toEqual([]);
        expect(globPreview('src/{a,b', '', files)).toMatchObject({ matches: [], error: expect.stringContaining('Unclosed') });
    });

    it('finds the glob under the cursor and previews every glob item', () => {
        const text = '---\nglobs: ["src/**/*.ts", "docs/**"]\n---\n';
        expect(globAt(text, 1, 12, '', files)?.glob).toBe('src/**/*.ts');
        expect(globAt(text, 1, 1, '', files)).toBeUndefined();
        expect(globPreviews(text, '', files).map(p => [p.glob, p.matches.length])).toEqual([['src/**/*.ts', 2], ['docs/**', 1]]);
    });
});
