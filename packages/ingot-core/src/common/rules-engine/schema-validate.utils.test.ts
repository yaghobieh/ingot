import { describe, expect, it } from 'vitest';
import { exportSchemas, schemaAt, schemaForPath, suggestKey, validateIngotFile } from './schema-validate.utils';
import { MCP_SCHEMA, SCHEMA_BASE_URL, SCHEMA_DRAFT, SCHEMA_FILE_SUFFIX } from './schemas.consts';

const messages = (path: string, text: string): string[] => validateIngotFile(path, text).diagnostics.map(d => `${d.severity}: ${d.message}`);

describe('schemaForPath', () => {
    it('maps every .ingot file kind, nested folders included', () => {
        expect(schemaForPath('.ingot/rules/react.mdc')?.id).toBe('rule');
        expect(schemaForPath('packages/web/.cursor/rules/x.md')?.id).toBe('rule');
        expect(schemaForPath('.ingot/commands/review.md')?.id).toBe('command');
        expect(schemaForPath('.ingot/skills/release/SKILL.md')?.id).toBe('skill');
        expect(schemaForPath('.ingot/agents/reviewer.md')?.id).toBe('subagent');
        expect(schemaForPath('.ingot/habits/deploy.md')?.id).toBe('habit');
        expect(schemaForPath('/Users/me/app/.ingot/mcp.json')?.id).toBe('mcp');
        expect(schemaForPath('.ingot/hooks.json')?.id).toBe('hooks');
        expect(schemaForPath('.ingot/environment.json')?.id).toBe('environment');
        expect(schemaForPath('.ingot/worktrees.json')?.id).toBe('worktrees');
        expect(schemaForPath('.ingot/policy.json')?.id).toBe('policy');
        expect(schemaForPath('.ingot/frozen.json')?.id).toBe('frozen');
        expect(schemaForPath('.ingot/doctor.json')?.id).toBe('doctor');
        expect(schemaForPath('src/rules/x.md')).toBeUndefined();
        expect(schemaForPath('.ingot/habits.json')).toBeUndefined();
    });
});

describe('frontmatter validation', () => {
    it('accepts a valid rule and flags unknown keys with a suggestion, wrong types and bad globs', () => {
        expect(messages('.ingot/rules/ok.md', '---\ndescription: ok\nglobs: ["src/**/*.ts"]\nalwaysApply: false\n---\nBody')).toEqual([]);
        expect(messages('.ingot/rules/bad.md', '---\nalwaysAplly: true\nalwaysApply: yes\nglobs: ["src/{a,b"]\n---\nBody')).toEqual([
            'warning: Unknown key "alwaysAplly". Did you mean "alwaysApply"?',
            'error: Use true or false.',
            'error: Unclosed "{" in src/{a,b.'
        ]);
    });

    it('warns when globs are ignored because alwaysApply is true', () => {
        expect(messages('.ingot/rules/x.md', '---\nglobs: src/**\nalwaysApply: true\n---\nBody')).toEqual([
            'warning: globs are ignored while alwaysApply is true; set alwaysApply: false to attach by globs.'
        ]);
    });

    it('requires a skill description and validates its name', () => {
        expect(messages('.ingot/skills/x/SKILL.md', '# no frontmatter')).toEqual(['error: Add frontmatter with "description" (--- description: … ---) at the top.']);
        expect(messages('.ingot/skills/x/SKILL.md', '---\nname: Bad Name\n---\n')).toEqual([
            'error: Does not match the expected format (^[a-z0-9][a-z0-9-]*$).',
            'error: Missing required key "description".'
        ]);
    });

    it('checks habit regexes and puts the range on the value', () => {
        const { diagnostics } = validateIngotFile('.ingot/habits/x.md', '---\nerrorRegex: "(unclosed"\n---\n');
        expect(diagnostics[0].message).toMatch(/^Invalid regular expression/);
        expect(diagnostics[0].range.line).toBe(1);
    });

    it('allows rules without frontmatter (they always apply)', () => {
        expect(messages('.ingot/rules/plain.md', 'Just text.')).toEqual([]);
    });
});

describe('JSON validation', () => {
    it('accepts mcp.json servers with a command or url, and flags the rest', () => {
        expect(messages('.ingot/mcp.json', '{ "mcpServers": { "a": { "command": "npx", "args": ["x"] }, "b": { "url": "https://x.dev/mcp" } } }')).toEqual([]);
        expect(messages('.ingot/mcp.json', '{ "mcpServers": { "a": { "args": [1], "comand": "npx" } } }')).toEqual([
            'error: Needs "command" or "url".',
            'error: Expected a string.',
            'warning: Unknown key "comand". Did you mean "command"?'
        ]);
        expect(messages('.ingot/mcp.json', '{}')).toEqual(['error: Missing required property "mcpServers".']);
    });

    it('validates both hooks.json shapes and reports parse errors', () => {
        expect(messages('.ingot/hooks.json', '{ "pre-commit": [{ "name": "lint", "run": "npm run lint" }], "version": 1, "hooks": { "stop": [{ "command": "./x.sh" }] } }')).toEqual([]);
        expect(messages('.ingot/hooks.json', '{ "hooks": { "onStop": [] }, "pre-push": [{ "name": "x" }] }')).toEqual([
            'warning: Unknown key "onStop". Did you mean "stop"?',
            'error: Needs "run" or "agent".'
        ]);
        expect(messages('.ingot/hooks.json', '{ "version": 1, }x')).toEqual(['error: Unexpected text after the end of the JSON value.']);
        expect(messages('.ingot/hooks.json', '{ "hooks": { "zzzzzzzz": [] } }')[0]).toMatch(/^warning: Unknown key "zzzzzzzz". Known keys: sessionStart, /);
    });

    it('checks ranges, enums and integers', () => {
        expect(messages('.ingot/environment.json', '{ "ports": [{ "port": 70000 }] }')).toEqual(['error: Must be at most 65535.']);
        expect(messages('.ingot/doctor.json', '{ "budget": 2.5, "ignore": ["nope"] }')).toEqual([
            'error: Expected a whole number.',
            'error: Expected one of: "conflict", "override", "dead-glob", "duplicate", "duplicate-line", "shadowed", "oversized", "budget", "empty", "manual-only", "schema".'
        ]);
    });
});

describe('schema helpers', () => {
    it('suggests close keys only', () => {
        expect(suggestKey('glob', ['globs', 'description'])).toBe('globs');
        expect(suggestKey('zzz', ['globs'])).toBeUndefined();
    });

    it('walks to nested schemas', () => {
        expect(schemaAt(MCP_SCHEMA, ['mcpServers', 'db', 'env'])?.type).toBe('object');
        expect(schemaAt(MCP_SCHEMA, ['mcpServers', 'db', 'args', '0'])?.type).toBe('string');
    });

    it('exports draft-07 documents with ids', () => {
        const exported = exportSchemas(SCHEMA_BASE_URL, SCHEMA_DRAFT, SCHEMA_FILE_SUFFIX);
        expect(exported.map(e => e.file)).toContain('rule.schema.json');
        expect(exported.find(e => e.file === 'mcp.schema.json')!.json).toMatchObject({ $schema: SCHEMA_DRAFT, $id: `${SCHEMA_BASE_URL}mcp.schema.json`, required: ['mcpServers'] });
    });
});
