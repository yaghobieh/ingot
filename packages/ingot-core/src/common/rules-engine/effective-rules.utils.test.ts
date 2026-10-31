import { describe, expect, it } from 'vitest';
import { effectiveRules, GLOBAL_LAYER } from './effective-rules.utils';
import { loadRuleDocs } from './rule-docs.utils';

const files: Record<string, string> = {
    'package.json': '{}',
    'packages/web/package.json': '{}',
    'AGENTS.md': '- Use npm for scripts.\n- Write tests.',
    'packages/AGENTS.md': 'Packages.',
    'packages/web/AGENTS.md': '- Use pnpm for scripts.',
    '.ingot/rules/testing.md': '---\nalwaysApply: true\n---\nUse jest.',
    'packages/web/.ingot/rules/testing.md': '---\nglobs: ["src/**"]\n---\nUse vitest.',
    '.ingot/rules/css.md': '---\nglobs: ["**/*.css"]\n---\nCSS.',
    '.cursor/rules/css.md': 'Old CSS.',
    '.ingot/rules/review.md': '---\ndescription: Code review\nalwaysApply: false\n---\nReview.',
    'packages/api/.ingot/rules/api.md': 'API only.',
    'packages/web/src/components/Cart.tsx': ''
};
const docs = loadRuleDocs({ files: Object.keys(files), read: p => files[p], globalFiles: [{ path: '~/.ingot/rules/me.md', text: 'Be brief.' }] });

describe('effectiveRules', () => {
    const view = effectiveRules(docs, Object.keys(files), 'packages/web/src/components/Cart.tsx');

    it('lists layers from global and root down to the package and folder', () => {
        expect(view.layers.map(l => [l.scope, l.kind])).toEqual([[GLOBAL_LAYER, 'global'], ['', 'root'], ['packages', 'folder'], ['packages/web', 'package']]);
    });

    it('marks what applies, what is overridden, shadowed or not matching', () => {
        expect(view.entries.map(e => `${e.path}: ${e.status}${e.overriddenBy ? ` by ${e.overriddenBy}` : ''}`)).toEqual([
            '~/.ingot/rules/me.md: applied',
            'AGENTS.md: applied',
            '.cursor/rules/css.md: shadowed by .ingot/rules/css.md',
            '.ingot/rules/css.md: not-matching',
            '.ingot/rules/review.md: available',
            '.ingot/rules/testing.md: overridden by packages/web/.ingot/rules/testing.md',
            'packages/AGENTS.md: overridden by packages/web/AGENTS.md',
            'packages/web/AGENTS.md: applied',
            'packages/web/.ingot/rules/testing.md: applied'
        ]);
        expect(view.entries.find(e => e.path === 'packages/web/.ingot/rules/testing.md')!.overrides).toEqual(['.ingot/rules/testing.md']);
        expect(view.entries.some(e => e.path.startsWith('packages/api'))).toBe(false);
    });

    it('marks lines a deeper rule contradicts and builds the merged prompt root first', () => {
        const root = view.entries.find(e => e.path === 'AGENTS.md')!;
        expect(root.lineOverrides).toEqual([{ line: 0, text: 'Use npm for scripts.', by: 'packages/web/AGENTS.md', byLine: 0, byText: 'Use pnpm for scripts.' }]);
        expect(view.merged.split('\n').filter(l => l.startsWith('## '))).toEqual([
            '## me (~/.ingot/rules/me.md)',
            '## AGENTS.md (AGENTS.md)',
            '## packages/web/AGENTS.md (packages/web/AGENTS.md)',
            '## packages/web/testing (packages/web/.ingot/rules/testing.md)'
        ]);
        expect(view.tokens).toBeGreaterThan(0);
    });

    it('applies the root css rule to a css file outside the package', () => {
        const css = effectiveRules(docs, Object.keys(files), 'styles/site.css');
        expect(css.entries.find(e => e.path === '.ingot/rules/css.md')).toMatchObject({ status: 'applied', reason: '**/*.css matches this file.' });
        expect(css.entries.find(e => e.path === '.ingot/rules/testing.md')!.status).toBe('applied');
    });
});
