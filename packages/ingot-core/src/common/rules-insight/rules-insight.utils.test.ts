import { describe, expect, it } from 'vitest';
import { buildRuleHitTurn, doctorSummaryText, findingToDiagnostic, formatTokens, globalRelative, groupFindings, promptPreview, ruleCostHint, schemaToDiagnostic } from './rules-insight.utils';
import { DOCTOR_SOURCE, PROMPT_PREVIEW_CHARS, SCHEMA_SOURCE } from './rules-insight.consts';
import type { DoctorReport } from '../rules-engine/rules-engine.types';

const report: DoctorReport = {
    rules: [
        { id: '.ingot/rules/always.md', name: 'always', path: '.ingot/rules/always.md', kind: 'always', source: 'ingot', scope: '', tokens: 1200, alwaysOn: true, shadowed: false },
        { id: '.cursor/rules/ts.mdc', name: 'ts', path: '.cursor/rules/ts.mdc', kind: 'auto', source: 'external', scope: '', tokens: 40, alwaysOn: false, shadowed: false }
    ],
    findings: [
        { code: 'dead-glob', severity: 'warning', message: 'Glob "x/**" matches no files', path: '.cursor/rules/ts.mdc', range: { line: 2, column: 8, endLine: 2, endColumn: 14 } },
        { code: 'manual-only', severity: 'info', message: 'manual', path: '.cursor/rules/ts.mdc' },
        { code: 'budget', severity: 'error', message: 'over', path: 'AGENTS.md' }
    ],
    budgets: [{ scope: '', tokens: 1250, budget: 4000, over: false, rules: ['.ingot/rules/always.md'] }],
    alwaysOnTokens: 1250,
    budget: 4000,
    summary: { errors: 1, warnings: 1, infos: 1 }
};

describe('rules insight utils', () => {
    it('turns doctor findings into Problems markers with LSP ranges', () => {
        const d = findingToDiagnostic(report.findings[0]);
        expect(d).toEqual({ range: { start: { line: 2, character: 8 }, end: { line: 2, character: 14 } }, severity: 2, message: 'Glob "x/**" matches no files', source: DOCTOR_SOURCE, code: 'dead-glob' });
        expect(findingToDiagnostic(report.findings[1]).range).toEqual({ start: { line: 0, character: 0 }, end: { line: 0, character: 0 } });
        expect(findingToDiagnostic(report.findings[2]).severity).toBe(1);
        expect(schemaToDiagnostic({ severity: 'error', message: 'bad', path: 'alwaysApply', range: { line: 1, column: 0, endLine: 1, endColumn: 4 } }).source).toBe(SCHEMA_SOURCE);
    });

    it('groups findings per file', () => {
        const groups = groupFindings(report.findings);
        expect([...groups.keys()]).toEqual(['.cursor/rules/ts.mdc', 'AGENTS.md']);
        expect(groups.get('.cursor/rules/ts.mdc')).toHaveLength(2);
    });

    it('maps global paths to the config folder', () => {
        expect(globalRelative('~/.ingot/rules/a.md')).toBe('rules/a.md');
        expect(globalRelative('~/.cursor/rules/a.md')).toBeUndefined();
        expect(globalRelative('.ingot/rules/a.md')).toBeUndefined();
    });

    it('summarizes a report and a rule cost', () => {
        expect(formatTokens(950)).toBe('950');
        expect(formatTokens(1250)).toBe('1.3k');
        expect(formatTokens(4000)).toBe('4k');
        expect(doctorSummaryText(report)).toBe('Rules Doctor: 1 error, 1 warning, 1 info · 2 rule files · always-on 1.3k / 4k tokens');
        expect(ruleCostHint(report.rules[0], report)).toBe('~1.2k tokens · always on · 1.3k of 4k always-on budget');
        expect(ruleCostHint(report.rules[1], report)).toBe('~40 tokens · auto');
    });

    it('builds a rule-hit turn from what the agent loaded', () => {
        const turn = buildRuleHitTurn({
            sessionId: 's1', prompt: 'Fix the button please', files: ['src/app.tsx'], root: '/p',
            rules: [
                { name: 'AGENTS.md', path: 'AGENTS.md', source: 'agents', body: 'Be brief.', globs: [], alwaysApply: true },
                { name: 'react', path: '.ingot/rules/react.md', source: 'ingot', body: 'Use function components.', globs: ['**/*.tsx'], alwaysApply: false },
                { name: 'style', path: '.cursor/rules/style.mdc', source: 'external', body: 'Tabs.', globs: [], alwaysApply: true }
            ]
        }, 's1:1', 42);
        expect(turn).toMatchObject({ id: 's1:1', sessionId: 's1', at: 42, root: '/p' });
        expect(turn.hits.map(h => [h.name, h.reason.code])).toEqual([['AGENTS.md', 'agents-file'], ['react', 'glob'], ['style', 'always']]);
        expect(turn.hits[1].reason.file).toBe('src/app.tsx');
        expect(turn.tokens).toBe(turn.hits.reduce((s, h) => s + h.tokens, 0));
        const mentioned = buildRuleHitTurn({ sessionId: 's1', prompt: 'Use @react here', files: [], rules: [{ name: 'react', path: '.ingot/rules/react.md', source: 'ingot', body: 'x', globs: ['**/*.tsx'], alwaysApply: false }] }, 's1:2', 43);
        expect(mentioned.hits[0].reason.code).toBe('mention');
    });

    it('shortens prompts for the panel', () => {
        expect(promptPreview('  hello\n world ')).toBe('hello world');
        expect(promptPreview('x'.repeat(200))).toHaveLength(PROMPT_PREVIEW_CHARS);
    });
});
