import { describe, expect, it } from 'vitest';
import { lineDelta, matchGlob, parseFrontmatter, ruleFromText, ruleName, selectRules } from './rules-kit.utils';

describe('rules kit basics', () => {
    it('parses frontmatter like the IDE does', () => {
        expect(parseFrontmatter('---\ndescription: TS\nglobs: ["**/*.ts", "*.tsx"]\nalwaysApply: false\ntags:\n  - a\n---\nBody').data)
            .toEqual({ description: 'TS', globs: ['**/*.ts', '*.tsx'], alwaysApply: false, tags: ['a'] });
        expect(parseFrontmatter('plain').body).toBe('plain');
    });

    it('builds rules: always-on without globs, scoped with globs, named from the path', () => {
        expect(ruleFromText('.ingot/rules/style.md', 'Be brief.')).toMatchObject({ name: 'style', alwaysApply: true, globs: [] });
        expect(ruleFromText('.ingot/rules/web/React Hooks.mdc', '---\nglobs: src/**/*.tsx\n---\nx')).toMatchObject({ name: 'web-react-hooks', alwaysApply: false, globs: ['src/**/*.tsx'] });
        expect(ruleName('.ingot/rules/a/b.md')).toBe('a-b');
    });

    it('matches globs', () => {
        expect(matchGlob('**/*.ts', 'src/index.ts')).toBe(true);
        expect(matchGlob('*.ts', 'src/deep/index.ts')).toBe(true);
        expect(matchGlob('src/*.ts', 'src/deep/index.ts')).toBe(false);
        expect(matchGlob('**/*.{ts,tsx}', 'a/b.tsx')).toBe(true);
        expect(matchGlob('docs/**', 'docs/a/b.md')).toBe(true);
        expect(matchGlob('./src/**', 'src/a.ts')).toBe(true);
    });

    it('selects rules by name or by files in context', () => {
        const always = ruleFromText('.ingot/rules/a.md', 'A');
        const scoped = ruleFromText('.ingot/rules/b.md', '---\nglobs: "*.tsx"\n---\nB');
        expect(selectRules([always, scoped], []).map(r => r.name)).toEqual(['a']);
        expect(selectRules([always, scoped], ['src/X.tsx']).map(r => r.name)).toEqual(['a', 'b']);
        expect(selectRules([always, scoped], [], ['b']).map(r => r.name)).toEqual(['b']);
    });

    it('counts added and removed lines', () => {
        expect(lineDelta('a\nb\nc', 'a\nc\nd\ne')).toEqual({ added: 2, removed: 1 });
        expect(lineDelta(undefined, 'x')).toEqual({ added: 1, removed: 0 });
    });
});
