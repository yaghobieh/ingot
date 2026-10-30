import { describe, expect, it } from 'vitest';
import { ruleFromFile } from '../project-config/project-config.utils';
import { CURSOR_IMPORT_SNOOZE_MS } from './cursor-rules-import.consts';
import {
    convertCursorRule, convertCursorrules, planCursorImport, shouldPromptCursorImport, toCursorImportMode, withoutImportedCursorrules
} from './cursor-rules-import.utils';

const TS_RULE = '---\ndescription: TypeScript style\nglobs: "**/*.ts"\nalwaysApply: false\nlastUpdated: 2025-01-01\n---\nUse explicit return types.\n';

describe('cursor rules import', () => {
    it('converts an .mdc rule to an Ingot rule that loads the same way', () => {
        const converted = convertCursorRule(TS_RULE);
        expect(converted).toBe('---\ndescription: TypeScript style\nglobs: "**/*.ts"\nalwaysApply: false\n---\nUse explicit return types.\n');
        const before = ruleFromFile('.cursor/rules/ts.mdc', TS_RULE, 'external');
        const after = ruleFromFile('.ingot/rules/ts.md', converted, 'ingot');
        expect({ ...after, path: '', source: '' }).toEqual({ ...before, path: '', source: '' });
    });

    it('keeps comma separated globs as one list and copies plain rules as is', () => {
        const converted = convertCursorRule('---\nglobs: src/**/*.ts, test/**\n---\nBody');
        expect(ruleFromFile('a.md', converted, 'ingot').globs).toEqual(['src/**/*.ts', 'test/**']);
        expect(convertCursorRule('Just text')).toBe('Just text\n');
    });

    it('turns .cursorrules into an always-on rule', () => {
        const rule = ruleFromFile('.ingot/rules/cursorrules.md', convertCursorrules('  Be brief.  '), 'ingot');
        expect(rule.alwaysApply).toBe(true);
        expect(rule.body).toBe('Be brief.');
    });

    it('plans only rules that .ingot does not have yet', () => {
        const plan = planCursorImport({
            rules: [{ fileName: 'ts.mdc', text: TS_RULE }, { fileName: 'style.md', text: 'Style' }, { fileName: 'notes.txt', text: 'skip' }, { fileName: 'TS.md', text: 'dup' }],
            cursorrules: 'Be brief.',
            ingotRules: ['style.md']
        });
        expect(plan.map(r => [r.fileName, r.from])).toEqual([['ts.md', '.cursor/rules/TS.md'], ['cursorrules.md', '.cursorrules']]);
        expect(planCursorImport({ rules: [{ fileName: 'ts.mdc', text: TS_RULE }], cursorrules: 'x', ingotRules: ['ts.md', 'cursorrules.md'] })).toEqual([]);
        expect(planCursorImport({ rules: [], cursorrules: '   ', ingotRules: [] })).toEqual([]);
    });

    it('asks once: never after Never, not again until Not now expires, not when nothing is left', () => {
        const now = 10 * CURSOR_IMPORT_SNOOZE_MS;
        expect(shouldPromptCursorImport(2, 'ask', undefined, now)).toBe(true);
        expect(shouldPromptCursorImport(0, 'ask', undefined, now)).toBe(false);
        expect(shouldPromptCursorImport(2, 'never', undefined, now)).toBe(false);
        expect(shouldPromptCursorImport(2, 'ask', now - 1, now)).toBe(false);
        expect(shouldPromptCursorImport(2, 'ask', now - CURSOR_IMPORT_SNOOZE_MS, now)).toBe(true);
        expect(toCursorImportMode('never')).toBe('never');
        expect(toCursorImportMode('bogus')).toBe('ask');
    });

    it('stops reading .cursorrules once it was imported', () => {
        const agents = [{ name: 'AGENTS.md' }, { name: '.cursorrules' }];
        expect(withoutImportedCursorrules(agents, [{ name: 'cursorrules' }])).toEqual([{ name: 'AGENTS.md' }]);
        expect(withoutImportedCursorrules(agents, [{ name: 'other' }])).toEqual(agents);
    });
});
