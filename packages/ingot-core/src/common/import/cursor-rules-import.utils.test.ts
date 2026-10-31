import { describe, expect, it } from 'vitest';
import { ruleFromFile } from '../project-config/project-config.utils';
import { convertCursorRule, convertCursorrules, toCursorImportMode, withoutImportedCursorrules } from './cursor-rules-import.utils';

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

    it('reads the ask / never preference, falling back to ask', () => {
        expect(toCursorImportMode('never')).toBe('never');
        expect(toCursorImportMode('bogus')).toBe('ask');
    });

    it('stops reading .cursorrules once it was imported', () => {
        const agents = [{ name: 'AGENTS.md' }, { name: '.cursorrules' }];
        expect(withoutImportedCursorrules(agents, [{ name: 'cursorrules' }])).toEqual([{ name: 'AGENTS.md' }]);
        expect(withoutImportedCursorrules(agents, [{ name: 'other' }])).toEqual(agents);
    });
});
