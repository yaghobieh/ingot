import { describe, expect, it } from 'vitest';
import type { KitProject } from './rules-kit.types';
import { parseHitLog, recordHits, serializeHitLog } from './rule-hits.utils';
import { collectDependencies, planPrune, pruneEdits, referencedPackages, referencedPaths, setGlobs } from './rules-prune.utils';
import { ruleFromText } from './rules-kit.utils';

const project = (files: Record<string, string>): KitProject => ({ files: Object.keys(files), read: path => files[path] });
const NOW = new Date('2026-10-31T12:00:00.000Z');
const daysAgo = (days: number): string => new Date(NOW.getTime() - days * 86_400_000).toISOString();

const FILES: Record<string, string> = {
    'package.json': JSON.stringify({ name: 'shop', dependencies: { react: '^19.0.0', '@tanstack/react-query': '^5.0.0' } }),
    'src/App.tsx': '',
    'src/cart/cart.ts': '',
    '.ingot/rules/react.md': '---\nglobs: src/**/*.tsx\n---\nUse function components with `@tanstack/react-query` for data.',
    '.ingot/rules/legacy.md': '---\nglobs:\n  - legacy/**/*.js\n  - "**/*.coffee"\n---\nUse jQuery helpers.',
    '.ingot/rules/mixed.md': '---\nglobs:\n  - src/**/*.ts\n  - old/**\n---\nKeep cart logic in `src/cart/cart.ts` and helpers in `src/helpers/money.ts`.',
    '.ingot/rules/redux.md': '---\ndeps: [redux]\n---\nUse slices.\n\n```ts\nimport { configureStore } from \'@reduxjs/toolkit\';\n```',
    '.ingot/rules/review.md': '---\nalwaysApply: false\ndescription: Code review checklist\n---\nCheck tests.'
};

describe('rule references', () => {
    it('finds packages in frontmatter, imports and backticks, ignoring builtins and relative paths', () => {
        const rule = ruleFromText('.ingot/rules/x.md', '---\nrequires: zod\n---\n```ts\nimport fs from \'node:fs\';\nimport path from \'path\';\nimport { a } from \'./a\';\nimport x from \'lodash/fp\';\n```\nUse `@scope/pkg` and `useState`.');
        expect(referencedPackages(rule)).toEqual({ declared: ['zod'], imported: ['lodash', '@scope/pkg'] });
    });

    it('finds backticked file and folder paths, not globs, URLs or packages', () => {
        const rule = ruleFromText('.ingot/rules/x.md', 'See `src/app.ts`, `docs/`, `src/**/*.ts`, `https://x.dev/a.md`, `@a/b`, `lodash/fp` and `./scripts/run.sh`.');
        expect(referencedPaths(rule)).toEqual(['src/app.ts', 'docs/', 'scripts/run.sh']);
    });

    it('collects npm, pip, go and composer dependencies', () => {
        const deps = collectDependencies(project({
            'package.json': '{"name":"root","devDependencies":{"vitest":"1"}}', 'packages/a/package.json': '{"name":"@acme/a"}',
            'node_modules/x/package.json': '{"name":"x"}', 'requirements.txt': 'Django>=4\n# c\nrequests', 'go.mod': 'module m\nrequire github.com/gin-gonic/gin v1.9.0',
            'composer.json': '{"require":{"laravel/framework":"^11"}}'
        }));
        expect([...deps!.all].sort()).toEqual(['@acme/a', 'django', 'github.com/gin-gonic/gin', 'laravel/framework', 'requests', 'root', 'vitest']);
        expect(collectDependencies(project({ 'a.txt': '' }))).toBeUndefined();
    });
});

describe('ingot rules prune', () => {
    it('flags dead globs, deleted paths and removed packages without usage data', () => {
        const plan = planPrune(project(FILES), { days: 90, now: NOW });
        expect(plan.usageWindowShort).toBe(true);
        const byRule = Object.fromEntries(plan.candidates.map(c => [c.rule, c]));
        expect(Object.keys(byRule).sort()).toEqual(['legacy', 'mixed', 'redux']);
        expect(byRule.legacy).toMatchObject({ action: 'delete', findings: [{ reason: 'dead-globs', items: ['legacy/**/*.js', '**/*.coffee'] }] });
        expect(byRule.mixed.action).toBe('remove-globs');
        expect(byRule.mixed.keepGlobs).toEqual(['src/**/*.ts']);
        expect(byRule.mixed.findings.map(f => [f.reason, f.items])).toEqual([['dead-globs', ['old/**']], ['dead-paths', ['src/helpers/money.ts']]]);
        expect(byRule.redux).toMatchObject({ action: 'delete', findings: [{ reason: 'missing-deps', items: ['redux', '@reduxjs/toolkit'] }] });
    });

    it('flags rules not hit in N days once usage covers N days; young rules and recent hits are kept', () => {
        let hits = recordHits(undefined, [], new Date(daysAgo(200)));
        hits = recordHits(hits, ['.ingot/rules/review.md'], new Date(daysAgo(120)));
        hits = recordHits(hits, ['.ingot/rules/react.md'], new Date(daysAgo(1)));
        const log = parseHitLog(serializeHitLog(hits))!;
        expect(log.rules['.ingot/rules/react.md'].hits).toBe(1);
        const plan = planPrune(project(FILES), { days: 90, now: NOW, hits: log, addedAt: { '.ingot/rules/redux.md': daysAgo(10) } });
        expect(plan.usageWindowShort).toBe(false);
        const unused = plan.candidates.filter(c => c.findings.some(f => f.reason === 'unused')).map(c => [c.rule, c.findings.find(f => f.reason === 'unused')!.detail]);
        expect(unused).toEqual([['legacy', 'not used by an agent in 90 days'], ['mixed', 'not used by an agent in 90 days'], ['review', 'last used 120 days ago']]);
        expect(plan.candidates.find(c => c.rule === 'review')!.action).toBe('delete');
    });

    it('does not call rules unused when nobody used an agent in the window', () => {
        const hits = recordHits(recordHits(undefined, [], new Date(daysAgo(300))), ['.ingot/rules/react.md'], new Date(daysAgo(100)));
        expect(planPrune(project(FILES), { days: 90, now: NOW, hits }).usageWindowShort).toBe(true);
    });

    it('applies deletes and glob removals, never review-only findings', () => {
        const files = { ...FILES, '.ingot/rules/notes.md': 'See `docs/gone.md`.' };
        const plan = planPrune(project(files), { days: 90, now: NOW });
        const edits = pruneEdits(project(files), plan);
        expect(edits.map(e => [e.path, e.content === null ? 'delete' : 'edit'])).toEqual([['.ingot/rules/legacy.md', 'delete'], ['.ingot/rules/mixed.md', 'edit'], ['.ingot/rules/redux.md', 'delete']]);
        expect(edits[1].content).toBe('---\nglobs:\n  - src/**/*.ts\n---\nKeep cart logic in `src/cart/cart.ts` and helpers in `src/helpers/money.ts`.');
        expect(pruneEdits(project(files), plan, ['legacy'])).toHaveLength(1);
    });

    it('rewrites globs as a list, keeping other frontmatter', () => {
        expect(setGlobs('---\ndescription: d\nglobs: a, b\nalwaysApply: false\n---\nBody', ['src/**/*.{ts,tsx}'])).toBe('---\ndescription: d\nalwaysApply: false\nglobs:\n  - src/**/*.{ts,tsx}\n---\nBody');
        expect(setGlobs('Body', ['x/**'])).toBe('---\nglobs:\n  - x/**\n---\nBody');
    });
});
