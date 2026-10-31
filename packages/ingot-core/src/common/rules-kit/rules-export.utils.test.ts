import { describe, expect, it } from 'vitest';
import { BLOCK_BEGIN, BLOCK_END, GENERATED_PREFIX } from './rules-kit.consts';
import type { KitProject } from './rules-kit.types';
import { exportWrites, mergeBlock, planExport, resolveTargets, stripExportBlock } from './rules-export.utils';
import { loadRules } from './rules-kit.utils';

const project = (files: Record<string, string>): KitProject => ({ files: Object.keys(files), read: path => files[path] });

const RULES = {
    '.ingot/rules/style.md': '---\ndescription: House style\n---\nUse named exports.',
    '.ingot/rules/ts.mdc': '---\ndescription: TypeScript\nglobs:\n  - src/**/*.ts\n  - "**/*.{ts,tsx}"\n---\nNo any.',
    '.ingot/rules/release.md': '---\ndescription: Writing release notes\nalwaysApply: false\n---\nKeep it short.',
    '.ingot/rules/private.md': '---\nexport: false\n---\nInternal only.',
    '.ingot/rules/backend/api.md': 'Return JSON errors.'
};

const apply = (files: Record<string, string>, writes: { path: string; content: string | null }[]): Record<string, string> => {
    const next = { ...files };
    for (const write of writes) {
        if (write.content === null) { delete next[write.path]; } else { next[write.path] = write.content; }
    }
    return next;
};

describe('ingot export plan', () => {
    it('loads nested rules with unique names', () => {
        expect(loadRules(project(RULES)).map(r => r.name)).toEqual(['backend-api', 'private', 'release', 'style', 'ts']);
    });

    it('writes every target from .ingot/rules, skipping export: false', () => {
        const plan = planExport(project(RULES));
        expect(plan.rules).toBe(4);
        expect(plan.drift).toBe(true);
        const byPath = Object.fromEntries(plan.files.map(f => [f.path, f]));
        expect(Object.keys(byPath).sort()).toEqual([
            '.cursor/rules/backend-api.mdc', '.cursor/rules/release.mdc', '.cursor/rules/style.mdc', '.cursor/rules/ts.mdc',
            '.github/copilot-instructions.md', '.github/instructions/ts.instructions.md',
            '.windsurf/rules/backend-api.md', '.windsurf/rules/release.md', '.windsurf/rules/style.md', '.windsurf/rules/ts.md',
            'AGENTS.md', 'CLAUDE.md'
        ]);
        const agents = byPath['AGENTS.md'].content!;
        expect(agents.startsWith('# AGENTS.md\n\n<!-- ingot:export:begin')).toBe(true);
        expect(agents).toContain('### ts\n\n_Applies to files matching `src/**/*.ts`, `**/*.{ts,tsx}`._\n\nNo any.');
        expect(agents).toContain('### release\n\n_Use when relevant: Writing release notes_');
        expect(agents).not.toContain('Internal only.');
        expect(byPath['.cursor/rules/ts.mdc'].content).toBe(`---\ndescription: TypeScript\nglobs: src/**/*.ts,**/*.{ts,tsx}\nalwaysApply: false\n---\n${GENERATED_PREFIX} from .ingot/rules/ts.mdc; edit that rule, then run \`ingot export\` -->\n\nNo any.\n`);
        expect(byPath['.windsurf/rules/ts.md'].content).toContain('trigger: glob\nglobs: src/**/*.ts, **/*.{ts,tsx}');
        expect(byPath['.windsurf/rules/release.md'].content).toContain('trigger: model_decision');
        expect(byPath['.windsurf/rules/style.md'].content).toContain('trigger: always_on');
        expect(byPath['.github/instructions/ts.instructions.md'].content).toContain('applyTo: "src/**/*.ts,**/*.{ts,tsx}"');
        expect(byPath['.github/copilot-instructions.md'].content).not.toContain('### ts');
    });

    it('is idempotent: after applying, --check finds no drift', () => {
        const files = apply(RULES, exportWrites(planExport(project(RULES))));
        const again = planExport(project(files));
        expect(again.drift).toBe(false);
        expect(again.files.every(f => f.action === 'unchanged')).toBe(true);
    });

    it('detects drift when a rule changes and deletes generated files of removed rules', () => {
        const files = apply(RULES, exportWrites(planExport(project(RULES))));
        files['.ingot/rules/style.md'] = 'Use default exports never.';
        delete files['.ingot/rules/release.md'];
        const plan = planExport(project(files));
        expect(plan.drift).toBe(true);
        const actions = Object.fromEntries(plan.files.filter(f => f.action !== 'unchanged').map(f => [f.path, f.action]));
        expect(actions).toMatchObject({ 'AGENTS.md': 'update', '.cursor/rules/style.mdc': 'update', '.cursor/rules/release.mdc': 'delete', '.windsurf/rules/release.md': 'delete' });
    });

    it('keeps hand-written text around the block and never overwrites hand-written rule files', () => {
        const files = { ...RULES, 'AGENTS.md': '# Shop\n\nRun npm test.\n', '.cursor/rules/style.mdc': 'My own Cursor rule.', '.cursor/rules/old.mdc': 'hand-written, keep' };
        const plan = planExport(project(files), { targets: ['agents', 'cursor'] });
        const agents = plan.files.find(f => f.path === 'AGENTS.md')!;
        expect(agents.action).toBe('update');
        expect(agents.content!.startsWith('# Shop\n\nRun npm test.\n\n<!-- ingot:export:begin')).toBe(true);
        const style = plan.files.find(f => f.path === '.cursor/rules/style.mdc')!;
        expect(style.action).toBe('skipped');
        expect(plan.files.some(f => f.path === '.cursor/rules/old.mdc')).toBe(false);
        expect(planExport(project(files), { targets: ['cursor'], force: true }).files.find(f => f.path === '.cursor/rules/style.mdc')!.action).toBe('update');
    });

    it('replaces only the block, removes it when no rules are left, and strips it for readers', () => {
        const block = `${BLOCK_BEGIN}\nold\n${BLOCK_END}`;
        const text = `# Top\n\n${block}\n\n## Footer\n`;
        expect(mergeBlock(text, `${BLOCK_BEGIN}\nnew\n${BLOCK_END}`, '# T')).toBe(`# Top\n\n${BLOCK_BEGIN}\nnew\n${BLOCK_END}\n\n## Footer\n`);
        expect(mergeBlock(text, undefined, '# T')).toBe('# Top\n\n## Footer\n');
        expect(stripExportBlock(text)).toBe('# Top\n\n## Footer');
        expect(mergeBlock(undefined, undefined, '# T')).toBeUndefined();
    });

    it('resolves targets from flags, then .ingot/export.json, and reports unknown names', () => {
        expect(resolveTargets(project({}), ['cursor', 'nope'])).toEqual({ targets: ['cursor'], unknown: ['nope'] });
        expect(resolveTargets(project({ '.ingot/export.json': '{"targets":["claude","agents"]}' })).targets).toEqual(['agents', 'claude']);
        expect(resolveTargets(project({})).targets).toHaveLength(5);
    });
});
