import { describe, expect, it } from 'vitest';
import { readDoctorConfig, runDoctor } from './doctor.utils';
import type { RulesWorkspace } from './rules-engine.types';

const workspace = (files: Record<string, string>, extra: string[] = []): RulesWorkspace => ({ files: [...Object.keys(files), ...extra], read: p => files[p] });
const codes = (ws: RulesWorkspace, options = {}) => runDoctor(ws, options).findings.map(f => `${f.severity} ${f.code} ${f.path}${f.range ? `:${f.range.line + 1}` : ''}`);

describe('runDoctor', () => {
    it('finds conflicts, dead globs, duplicates, shadowed and manual-only rules', () => {
        const ws = workspace({
            'AGENTS.md': '# Project\n- Use tabs for indentation.\n- Always run the tests before you commit anything.',
            '.ingot/rules/style.md': '---\nalwaysApply: true\n---\n- Use 2 spaces for indentation.\n- Always run the tests before you commit anything.',
            '.ingot/rules/react.md': '---\nglobs: ["src/**/*.tsx", "app/**/*.vue"]\n---\nUse hooks.',
            '.ingot/rules/copy.md': '---\nglobs: src/**\n---\nuse   HOOKS.',
            '.cursor/rules/style.md': 'Old style.',
            '.ingot/rules/manual.md': '---\nalwaysApply: false\n---\nOnly on request.'
        }, ['src/App.tsx']);
        expect(codes(ws)).toEqual([
            'warning shadowed .cursor/rules/style.md:1',
            'warning dead-glob .ingot/rules/react.md:2',
            'warning duplicate .ingot/rules/react.md:4',
            'warning conflict .ingot/rules/style.md:4',
            'info manual-only .ingot/rules/manual.md:1',
            'info duplicate-line .ingot/rules/style.md:5'
        ]);
        const conflict = runDoctor(ws).findings.find(f => f.code === 'conflict')!;
        expect(conflict.message).toBe('"Use 2 spaces for indentation." contradicts "Use tabs for indentation." in AGENTS.md:2.');
        expect(conflict.related?.[0]).toMatchObject({ path: 'AGENTS.md', range: { line: 1 } });
        expect(runDoctor(ws).findings.find(f => f.code === 'dead-glob')!.range).toEqual({ line: 1, column: 24, endLine: 1, endColumn: 38 });
    });

    it('reports nested contradictions as overrides, not conflicts', () => {
        const ws = workspace({ 'AGENTS.md': 'Use npm.', 'packages/web/AGENTS.md': 'Use pnpm.' }, ['packages/web/package.json']);
        expect(codes(ws)).toEqual(['info override packages/web/AGENTS.md:1']);
    });

    it('costs every rule and checks the always-on budget per folder', () => {
        const report = runDoctor(workspace({
            'AGENTS.md': 'x'.repeat(4_000), '.ingot/rules/ts.md': `---\nglobs: "**/*.ts"\n---\n${'y'.repeat(400)}`, 'packages/web/AGENTS.md': 'z'.repeat(4_000)
        }, ['a.ts']), { budget: 1_500, maxRuleTokens: 900 });
        expect(report.rules.map(r => [r.path, r.tokens, r.alwaysOn])).toEqual([['AGENTS.md', 1_000, true], ['packages/web/AGENTS.md', 1_000, true], ['.ingot/rules/ts.md', 100, false]]);
        expect(report.budgets.map(b => [b.scope, b.tokens, b.over])).toEqual([['', 1_000, false], ['packages/web', 2_000, true]]);
        expect(report.alwaysOnTokens).toBe(1_000);
        expect(report.findings.map(f => f.code)).toEqual(['oversized', 'budget', 'oversized']);
        expect(report.findings.find(f => f.code === 'budget')!.message).toContain('for packages/web/ cost ~2000 tokens every turn, over the 1500 budget');
    });

    it('includes schema problems of .ingot files and honours doctor.json', () => {
        const ws = workspace({
            '.ingot/mcp.json': '{ "mcpServers": { "x": {} } }',
            '.ingot/rules/a.md': '---\nalwaysApply: false\n---\nA',
            '.ingot/doctor.json': '{ "ignore": ["manual-only"], "budget": 10 }'
        });
        const report = runDoctor(ws);
        expect(report.findings.map(f => `${f.code}: ${f.message}`)).toEqual(['schema: Needs "command" or "url".']);
        expect(report.budget).toBe(10);
        expect(report.summary).toEqual({ errors: 1, warnings: 0, infos: 0 });
        expect(readDoctorConfig('{ "budget": -1, "ignore": ["budget", "x"] }')).toEqual({ ignore: ['budget'] });
    });
});
