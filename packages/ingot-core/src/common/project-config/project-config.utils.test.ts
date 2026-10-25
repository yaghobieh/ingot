import { describe, expect, it } from 'vitest';
import { applicableRules, commandFromFile, expandCommand, matchGlob, mergeByName, parseFrontmatter, parseMcpJson, ruleFromFile } from './project-config.utils';

describe('project config', () => {
    it('parses frontmatter with lists and booleans', () => {
        const fm = parseFrontmatter('---\ndescription: TS style\nglobs: ["**/*.ts", "*.tsx"]\nalwaysApply: false\ntags:\n  - a\n  - b\n---\nUse strict types.');
        expect(fm.data).toEqual({ description: 'TS style', globs: ['**/*.ts', '*.tsx'], alwaysApply: false, tags: ['a', 'b'] });
        expect(fm.body).toBe('Use strict types.');
        expect(parseFrontmatter('plain').body).toBe('plain');
    });

    it('builds rules: always-on without globs, scoped with globs', () => {
        expect(ruleFromFile('.ingot/rules/style.md', 'Be brief.', 'ingot')).toMatchObject({ name: 'style', alwaysApply: true, globs: [] });
        const scoped = ruleFromFile('.cursor/rules/ts.mdc', '---\nglobs: src/**/*.ts\n---\nNo any.', 'cursor');
        expect(scoped).toMatchObject({ name: 'ts', alwaysApply: false, globs: ['src/**/*.ts'], body: 'No any.' });
        expect(applicableRules([scoped], ['README.md'])).toEqual([]);
        expect(applicableRules([scoped], ['src/a/b.ts'])).toEqual([scoped]);
        expect(ruleFromFile('AGENTS.md', 'Hi', 'agents').name).toBe('AGENTS.md');
    });

    it('matches globs', () => {
        expect(matchGlob('**/*.ts', 'src/index.ts')).toBe(true);
        expect(matchGlob('**/*.ts', 'index.ts')).toBe(true);
        expect(matchGlob('*.ts', 'src/deep/index.ts')).toBe(true);
        expect(matchGlob('src/*.ts', 'src/deep/index.ts')).toBe(false);
        expect(matchGlob('**/*.{ts,tsx}', 'a/b.tsx')).toBe(true);
        expect(matchGlob('docs/**', 'docs/a/b.md')).toBe(true);
    });

    it('expands slash commands and skills', () => {
        const explain = commandFromFile('.ingot/commands/explain.md', '# Explain code\nExplain $ARGUMENTS simply.', 'ingot');
        expect(explain).toMatchObject({ name: 'explain', description: 'Explain code' });
        expect(expandCommand('/explain the math module', [explain])?.text).toBe('# Explain code\nExplain the math module simply.');
        const review = commandFromFile('.cursor/commands/review.md', 'Review the diff.', 'cursor');
        expect(expandCommand('/review src/a.ts', [review])?.text).toBe('Review the diff.\n\nsrc/a.ts');
        expect(expandCommand('/nope', [review])).toBeUndefined();
        const skill = commandFromFile('.ingot/skills/release-notes/SKILL.md', '---\nname: Release Notes\ndescription: Write notes\n---\nSteps', 'ingot', 'skill');
        expect(skill).toMatchObject({ name: 'release-notes', kind: 'skill', description: 'Write notes' });
    });

    it('parses mcp.json (stdio and http) and merges by name', () => {
        const servers = parseMcpJson(JSON.stringify({ mcpServers: { echo: { command: 'node', args: ['s.mjs'], env: { TOKEN: 'x' } }, web: { url: 'http://localhost:1/mcp' }, bad: {} } }), 'ingot');
        expect(servers.map(s => s.name)).toEqual(['echo', 'web']);
        expect(servers[0]).toMatchObject({ command: 'node', args: ['s.mjs'], env: { TOKEN: 'x' } });
        expect(parseMcpJson('nope', 'ingot')).toEqual([]);
        expect(mergeByName([{ name: 'a', v: 1 }], [{ name: 'a', v: 2 }, { name: 'b', v: 3 }])).toEqual([{ name: 'a', v: 2 }, { name: 'b', v: 3 }]);
    });
});
