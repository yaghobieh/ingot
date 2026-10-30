import { describe, expect, it } from 'vitest';
import {
    applicableRules, commandFolder, commandFromFile, expandCommand, findRule, formatRuleIndex, formatRules, matchGlob, mentionableRules, mergeByName, nestedRuleScope,
    parseFrontmatter, parseMcpJson, requestableRules, ruleFromFile, ruleFileName, ruleFileText, ruleKindLabel, ruleMentionItems
} from './project-config.utils';

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

describe('IDEA-287 rule kinds and nested rules', () => {
    it('reads Cursor rule types from frontmatter', () => {
        expect(ruleFromFile('.ingot/rules/a.md', '---\nalwaysApply: true\n---\nA', 'ingot').kind).toBe('always');
        expect(ruleFromFile('.ingot/rules/b.md', '---\nglobs: "**/*.ts"\n---\nB', 'ingot').kind).toBe('auto');
        const requested = ruleFromFile('.ingot/rules/api.md', '---\ndescription: How to write API handlers\nalwaysApply: false\n---\nUse zod.', 'ingot');
        expect(requested).toMatchObject({ kind: 'agent', alwaysApply: false, description: 'How to write API handlers' });
        expect(ruleFromFile('.ingot/rules/c.md', '---\ndescription: \nglobs: \nalwaysApply: false\n---\nC', 'ingot').kind).toBe('manual');
        expect(ruleFromFile('.ingot/rules/plain.md', 'Plain', 'ingot').kind).toBe('always');
        expect(ruleFromFile('AGENTS.md', '---\nalwaysApply: false\n---\nHi', 'agents').kind).toBe('always');
        expect(ruleKindLabel(requested)).toBe('agent requested');
    });

    it('lists agent-requested rules in an index and finds them by name', () => {
        const api = ruleFromFile('.ingot/rules/api.md', '---\ndescription: API handlers\n---\nUse zod.', 'ingot');
        const manual = ruleFromFile('.ingot/rules/bear.md', '---\nalwaysApply: false\n---\nUse Bear.', 'ingot');
        expect(applicableRules([api, manual], ['src/a.ts'])).toEqual([]);
        expect(requestableRules([api, manual])).toEqual([api]);
        const index = formatRuleIndex([api], 'ingot/fetch_rule');
        expect(index).toContain('ingot/fetch_rule');
        expect(index).toContain('- api: API handlers');
        expect(findRule([api, manual], '@Bear')).toBe(manual);
        expect(mentionableRules([ruleFromFile('.ingot/rules/z.md', 'Z', 'ingot'), manual]).map(r => r.name)).toEqual(['bear', 'z']);
    });

    it('writes rule files that load back as the chosen kind (IDEA-295)', () => {
        expect(ruleFileName('API style!')).toBe('api-style.md');
        expect(ruleFileName('  ')).toBeUndefined();
        for (const kind of ['always', 'auto', 'agent', 'manual'] as const) {
            const text = ruleFileText({ name: 'x', kind, description: 'When writing APIs', globs: 'src/**/*.ts, *.tsx', body: 'Body' });
            const rule = ruleFromFile('.ingot/rules/x.md', text, 'ingot');
            expect(rule.kind).toBe(kind);
            expect(rule.body).toBe('Body');
        }
        expect(ruleFromFile('x.md', ruleFileText({ name: 'x', kind: 'auto', globs: 'src/**/*.ts, *.tsx', body: 'B' }), 'ingot').globs).toEqual(['src/**/*.ts', '*.tsx']);
    });

    it('offers rules in the @ menu, matching name or description', () => {
        const api = ruleFromFile('.ingot/rules/api.md', '---\ndescription: API handlers\n---\nUse zod.', 'ingot');
        const bear = ruleFromFile('.ingot/rules/bear.md', '---\nalwaysApply: false\n---\nUse Bear.', 'ingot');
        expect(ruleMentionItems([api, bear], 'be')).toEqual(['rule:bear']);
        expect(ruleMentionItems([api, bear], 'handlers')).toEqual(['rule:api']);
        expect(ruleMentionItems([api, bear], '')).toEqual(['rule:api', 'rule:bear']);
        expect(ruleMentionItems([api, bear], 'zzz')).toEqual([]);
    });

    it('applies nested rules only under their folder; the closest AGENTS.md wins', () => {
        expect(nestedRuleScope('packages/web/.ingot/rules/react.md')).toEqual({ scope: 'packages/web', source: 'ingot' });
        expect(nestedRuleScope('packages/web/.cursor/rules/deep/x.mdc')).toEqual({ scope: 'packages/web', source: 'external' });
        expect(nestedRuleScope('packages/web/AGENTS.md')).toEqual({ scope: 'packages/web', source: 'agents' });
        expect(nestedRuleScope('.ingot/rules/root.md')).toBeUndefined();
        expect(nestedRuleScope('AGENTS.md')).toBeUndefined();

        const root = ruleFromFile('AGENTS.md', 'Root', 'agents');
        const pkg = ruleFromFile('packages/AGENTS.md', 'Packages', 'agents', 'packages');
        const web = ruleFromFile('packages/web/AGENTS.md', 'Web', 'agents', 'packages/web');
        const tsx = ruleFromFile('packages/web/.ingot/rules/tsx.md', '---\nglobs: src/**/*.tsx\n---\nTSX', 'ingot', 'packages/web');
        expect(web.name).toBe('packages/web/AGENTS.md');
        const all = [web, tsx, pkg, root];
        expect(applicableRules(all, ['README.md'])).toEqual([root]);
        expect(applicableRules(all, ['packages/web/src/App.tsx'])).toEqual([root, web, tsx]);
        expect(applicableRules(all, ['packages/api/index.ts'])).toEqual([root, pkg]);
        expect(applicableRules(all, ['packages/web/README.md'])).toEqual([root, web]);
        expect(formatRules([web])).toContain('(for files under packages/web/)');
    });
});

describe('IDEA-249 command folders', () => {
    it('takes the name from the file (dropping .prompt), args from frontmatter, and shows the folder', () => {
        const notes = commandFromFile('.github/prompts/release-notes.prompt.md', '---\ndescription: Draft notes\nargs: <version>\n---\nNotes for $ARGUMENTS.', 'external');
        expect(notes).toMatchObject({ name: 'release-notes', description: 'Draft notes', args: '<version>' });
        expect(commandFolder(notes)).toBe('.github/prompts');
        expect(commandFolder(commandFromFile('~/.claude/commands/standup.md', 'Standup.', 'global-imported'))).toBe('~/.claude/commands');
        expect(commandFolder(commandFromFile('.ingot/skills/pdf/SKILL.md', '---\nname: pdf\n---\nPDF.', 'ingot', 'skill'))).toBe('.ingot/skills');
    });
});
