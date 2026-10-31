import { describe, expect, it } from 'vitest';
import { applicableDocs, classifyRulePath, loadRuleDocs, packageRoots, resolveShadowing, ruleDocFromFile, ruleDocFromLoaded } from './rule-docs.utils';
import { filesMatching, globSyntaxError, matchGlob } from './glob.utils';
import type { RulesWorkspace } from './rules-engine.types';

const workspace = (files: Record<string, string>, extra: string[] = []): RulesWorkspace => ({ files: [...Object.keys(files), ...extra], read: p => files[p] });

describe('globs', () => {
    it('matches like the IDE, including name-only globs and braces', () => {
        expect(matchGlob('**/*.ts', 'src/a.ts')).toBe(true);
        expect(matchGlob('*.ts', 'src/deep/a.ts')).toBe(true);
        expect(matchGlob('src/*.{ts,tsx}', 'src/a.tsx')).toBe(true);
        expect(matchGlob('src/*.ts', 'src/deep/a.ts')).toBe(false);
        expect(filesMatching('src/**', ['packages/web/src/a.ts', 'src/b.ts'], 'packages/web')).toEqual(['packages/web/src/a.ts']);
        expect(globSyntaxError('src/{a')).toBe('Unclosed "{" in src/{a.');
        expect(globSyntaxError('/src/**')).toMatch(/leading "\/"/);
    });
});

describe('rule documents', () => {
    it('classifies rule, agent, habit and global files with their folder', () => {
        expect(classifyRulePath('.ingot/rules/a.md')).toEqual({ source: 'ingot', scope: '' });
        expect(classifyRulePath('packages/web/.cursor/rules/sub/b.mdc')).toEqual({ source: 'external', scope: 'packages/web' });
        expect(classifyRulePath('.alloy/rules/c.md')).toEqual({ source: 'legacy', scope: '' });
        expect(classifyRulePath('packages/api/AGENTS.md')).toEqual({ source: 'agents', scope: 'packages/api' });
        expect(classifyRulePath('CLAUDE.md')).toEqual({ source: 'agents', scope: '' });
        expect(classifyRulePath('.cursorrules')).toEqual({ source: 'agents', scope: '' });
        expect(classifyRulePath('.ingot/habits/deploy.md')).toEqual({ source: 'habit', scope: '' });
        expect(classifyRulePath('~/.ingot/rules/me.md')).toEqual({ source: 'global', scope: '' });
        expect(classifyRulePath('node_modules/x/AGENTS.md')).toBeUndefined();
        expect(classifyRulePath('src/readme.md')).toBeUndefined();
    });

    it('derives kinds as Cursor does', () => {
        const kind = (text: string) => ruleDocFromFile('.ingot/rules/x.md', text).kind;
        expect(kind('Body')).toBe('always');
        expect(kind('---\nalwaysApply: true\nglobs: a\n---\nB')).toBe('always');
        expect(kind('---\nglobs: src/**\n---\nB')).toBe('auto');
        expect(kind('---\ndescription: when testing\nalwaysApply: false\n---\nB')).toBe('agent');
        expect(kind('---\nalwaysApply: false\n---\nB')).toBe('manual');
        const nested = ruleDocFromFile('packages/web/.ingot/rules/react.md', '---\nglobs: src/**\n---\n\n\nUse hooks.\n');
        expect(nested).toMatchObject({ name: 'packages/web/react', baseName: 'react', scope: 'packages/web', bodyLine: 5, tokens: 3 });
    });

    it('converts rules the IDE loaded', () => {
        expect(ruleDocFromLoaded({ name: 'ts', path: '.cursor/rules/ts.mdc', source: 'external', body: 'x', globs: ['**/*.ts'], alwaysApply: false })).toMatchObject({ source: 'external', kind: 'auto', scope: '' });
        expect(ruleDocFromLoaded({ name: 'AGENTS.md', path: 'AGENTS.md', source: 'agents', body: 'x', globs: [], alwaysApply: true }).kind).toBe('always');
        expect(ruleDocFromLoaded({ name: 'me', path: '~/.ingot/rules/me.md', source: 'global-imported', body: 'x', globs: [], alwaysApply: false }).kind).toBe('manual');
    });

    it('lets .ingot win over .cursor and the global folder on a name clash, per folder', () => {
        const docs = loadRuleDocs({
            ...workspace({ '.cursor/rules/style.md': 'cursor', '.ingot/rules/style.md': 'ingot', 'packages/web/.cursor/rules/style.md': 'web' }),
            globalFiles: [{ path: '~/.ingot/rules/style.md', text: 'global' }]
        });
        const { winners, shadowed } = resolveShadowing(docs);
        expect(winners.map(w => w.path)).toEqual(['.ingot/rules/style.md', 'packages/web/.cursor/rules/style.md']);
        expect(shadowed.map(s => [s.doc.path, s.by.path])).toEqual([
            ['~/.ingot/rules/style.md', '.ingot/rules/style.md'],
            ['.cursor/rules/style.md', '.ingot/rules/style.md']
        ]);
    });

    it('applies nested rules only under their folder and only the closest nested AGENTS.md', () => {
        const docs = loadRuleDocs(workspace({
            'AGENTS.md': 'root', 'packages/AGENTS.md': 'packages', 'packages/web/AGENTS.md': 'web',
            '.ingot/rules/ts.md': '---\nglobs: "**/*.ts"\n---\nts', 'packages/api/.ingot/rules/api.md': 'api',
            '.ingot/rules/manual.md': '---\nalwaysApply: false\n---\nm'
        }));
        expect(applicableDocs(docs, ['packages/web/src/a.ts']).map(d => d.path)).toEqual(['AGENTS.md', '.ingot/rules/ts.md', 'packages/web/AGENTS.md']);
        expect(applicableDocs(docs, ['packages/api/x.js'], ['@manual']).map(d => d.path)).toEqual(['AGENTS.md', '.ingot/rules/manual.md', 'packages/AGENTS.md', 'packages/api/.ingot/rules/api.md']);
    });

    it('finds package roots', () => {
        expect([...packageRoots(['package.json', 'packages/web/package.json', 'services/go/go.mod', 'node_modules/x/package.json'])]).toEqual(['', 'packages/web', 'services/go']);
    });
});
