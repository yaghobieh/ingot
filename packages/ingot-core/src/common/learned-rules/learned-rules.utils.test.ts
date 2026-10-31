import { describe, expect, it } from 'vitest';
import {
    correctionInstruction, decideProposal, emptyLearnedState, learnedRulePath, learnFromMessage, learnFromRejection, parseLearnedState, pendingProposals,
    renderLearnedRule, serializeLearnedState, similarity, correctionWords, slugify
} from './learned-rules.utils';

const NOW = new Date('2026-10-31T10:00:00Z');

describe('learnFromRejection', () => {
    it('drafts a rule from a known pattern in the rejected lines, scoped to the file type', () => {
        const { state, proposal } = learnFromRejection(emptyLearnedState(), [
            { path: 'src/cart.ts', added: ['export const total = 1;', '  console.log(total);'], removed: ['export const total = 1;'] }
        ], NOW);
        expect(proposal).toMatchObject({ key: 'rejection:console-log', source: 'rejection', title: 'No console.log in code', globs: ['**/*.ts'], status: 'pending' });
        expect(proposal?.path).toBe('.ingot/rules/learned-no-console-log-in-code.md');
        expect(proposal?.evidence).toEqual(['src/cart.ts: console.log(total);']);
        expect(pendingProposals(state)).toHaveLength(1);
    });

    it('ignores lines the old code already had, unknown patterns, and patterns it already proposed', () => {
        expect(learnFromRejection(emptyLearnedState(), [{ path: 'a.ts', added: ['console.log(1)'], removed: ['console.log(1)'] }], NOW).proposal).toBeUndefined();
        expect(learnFromRejection(emptyLearnedState(), [{ path: 'a.ts', added: ['const x = 2;'], removed: [] }], NOW).proposal).toBeUndefined();
        const first = learnFromRejection(emptyLearnedState(), [{ path: 'a.ts', added: ['export default App;'], removed: [] }], NOW);
        const dismissed = decideProposal(first.state, first.proposal!.id, 'dismissed', NOW);
        expect(learnFromRejection(dismissed, [{ path: 'b.tsx', added: ['export default Page;'], removed: [] }], NOW).proposal).toBeUndefined();
    });

    it('recognises the other patterns', () => {
        const key = (line: string) => learnFromRejection(emptyLearnedState(), [{ path: 'x.ts', added: [line], removed: [] }], NOW).proposal?.key;
        expect(key('const a: any = 1;')).toBe('rejection:any-type');
        expect(key('// @ts-ignore')).toBe('rejection:ts-ignore');
        expect(key('import { a } from \'../lib/a\';')).toBe('rejection:parent-import');
        expect(key('var a = 1;')).toBe('rejection:var');
        expect(key('// TODO: later')).toBe('rejection:todo');
        expect(key('color: #ff0000;')).toBe('rejection:hex-color');
    });
});

describe('corrections', () => {
    it('finds the instruction in a correcting message', () => {
        expect(correctionInstruction('No, use pnpm instead of npm.')).toBe('Use pnpm instead of npm.');
        expect(correctionInstruction('Again, don\'t add comments to every line! It is noisy.')).toBe('Don\'t add comments to every line.');
        expect(correctionInstruction('never use default exports')).toBe('Never use default exports.');
        expect(correctionInstruction('Use React for the settings page')).toBeUndefined();
        expect(correctionInstruction('Add a cart page')).toBeUndefined();
        expect(correctionInstruction('No')).toBeUndefined();
    });

    it('matches the same correction in other words', () => {
        expect(similarity(correctionWords('Don\'t use npm, use pnpm.'), correctionWords('Never use npm; always pnpm.'))).toBeGreaterThanOrEqual(0.5);
        expect(similarity(correctionWords('Don\'t use npm.'), correctionWords('Don\'t add comments.'))).toBeLessThan(0.5);
    });

    it('proposes a rule the second time, never again for the same correction', () => {
        const once = learnFromMessage(emptyLearnedState(), 'No, use pnpm instead of npm.', NOW);
        expect(once.proposal).toBeUndefined();
        expect(once.state.corrections).toHaveLength(1);
        const twice = learnFromMessage(once.state, 'I said use pnpm, not npm. Again: pnpm instead of npm', NOW);
        expect(twice.proposal).toMatchObject({ source: 'correction', globs: [], status: 'pending' });
        expect(twice.proposal?.body).toMatch(/pnpm/);
        expect(twice.proposal?.evidence).toHaveLength(2);
        expect(learnFromMessage(twice.state, 'No, use pnpm instead of npm!', NOW).proposal).toBeUndefined();
    });

    it('does not count ordinary prompts', () => {
        let state = emptyLearnedState();
        for (const message of ['Add a login page', 'Use React for the settings page', 'Use React for the settings page']) {
            state = learnFromMessage(state, message, NOW).state;
        }
        expect(state.corrections).toHaveLength(0);
        expect(state.proposals).toHaveLength(0);
    });
});

describe('rule files and state', () => {
    it('renders frontmatter like a hand-written rule', () => {
        expect(renderLearnedRule({ title: 'No any', globs: ['**/*.ts'], body: 'Avoid any.', source: 'rejection' }))
            .toBe('---\ndescription: No any\nglobs: **/*.ts\nlearned: rejection\n---\nAvoid any.\n');
        expect(renderLearnedRule({ title: 'Use pnpm', globs: [], body: 'x', source: 'correction' }, 'Use pnpm, not npm.')).toContain('alwaysApply: true\nlearned: correction\n---\nUse pnpm, not npm.\n');
    });

    it('numbers paths that are taken and slugs safely', () => {
        expect(slugify('Don\'t use `any` — ever!')).toBe('don-t-use-any-ever');
        expect(learnedRulePath('No var', ['.ingot/rules/learned-no-var.md'])).toBe('.ingot/rules/learned-no-var-2.md');
    });

    it('round-trips and tolerates a broken file', () => {
        const { state } = learnFromRejection(emptyLearnedState(), [{ path: 'a.ts', added: ['var a = 1;'], removed: [] }], NOW);
        expect(parseLearnedState(serializeLearnedState(state))).toEqual(state);
        expect(parseLearnedState('{oops')).toEqual(emptyLearnedState());
        const accepted = decideProposal(state, state.proposals[0].id, 'accepted', NOW, 'Edited.');
        expect(accepted.proposals[0]).toMatchObject({ status: 'accepted', body: 'Edited.', decidedAt: NOW.toISOString() });
        expect(pendingProposals(accepted)).toHaveLength(0);
    });
});
