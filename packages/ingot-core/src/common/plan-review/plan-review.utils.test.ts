import { describe, expect, it } from 'vitest';
import { generalizeStep, planFileText, planPath, planTemplate, planTemplatePath, reviewHeadline, reviewMarkdown, reviewPlan, stepFiles, stepKeywords, templatePrompt } from './plan-review.utils';

const STEPS = [
    'Fix the rounding in `src/cart.ts`',
    'Add a regression test in src/cart.test.ts',
    'Update the checkout copy',
    'Run the unit tests'
];

describe('IDEA-306 plan files', () => {
    it('saves approved plans under .ingot/plans', () => {
        expect(planPath('Fix the cart', new Date('2026-10-31T06:08:12Z'))).toBe('.ingot/plans/2026-10-31T06-08-12-fix-the-cart.md');
        expect(planTemplatePath('bugfix')).toBe('.ingot/plans/templates/bugfix.md');
        const text = planFileText({ path: 'p', title: 'Fix the cart', prompt: 'fix\nit', taskType: 'bugfix', steps: STEPS, approvedAt: 'now' });
        expect(text).toContain('taskType: bugfix');
        expect(text).toContain('Request: fix it');
        expect(text).toContain('1. Fix the rounding in `src/cart.ts`');
        expect(text).toContain('4. Run the unit tests');
    });

    it('reads the files and words a step names', () => {
        expect(stepFiles('Fix `src/cart.ts`, then README.md and src/payments/')).toEqual(['src/cart.ts', 'README.md', 'src/payments']);
        expect(stepFiles('Bump to 1.2.3 per https://example.com/a.b')).toEqual([]);
        expect(stepKeywords('Update the checkout copy in src/a.ts')).toEqual(['checkout', 'copy']);
    });
});

describe('IDEA-306 review', () => {
    it('flags matched steps, missing steps and out-of-scope files', () => {
        const review = reviewPlan('.ingot/plans/p.md', STEPS, { files: ['src/cart.ts', 'src/cart.test.ts', 'src/legacy/util.ts'], commands: [] });
        expect(review.steps.map(s => s.state)).toEqual(['matched', 'matched', 'missing', 'missing']);
        expect(review.steps[0].evidence).toEqual(['src/cart.ts']);
        expect(review.outOfScope).toEqual(['src/legacy/util.ts']);
        expect(review).toMatchObject({ matched: 2, total: 4 });
        expect(reviewHeadline(review)).toBe('2 of 4 steps matched · 1 out-of-scope file');
    });

    it('matches steps by the words that describe a file and run steps by commands', () => {
        const review = reviewPlan('p', STEPS, { files: ['src/cart.ts', 'src/cart.test.ts', 'src/views/CheckoutPage.tsx'], commands: ['npm test'] });
        expect(review.steps.map(s => s.state)).toEqual(['matched', 'matched', 'matched', 'matched']);
        expect(review.steps[2].evidence).toEqual(['src/views/CheckoutPage.tsx']);
        expect(review.steps[3].evidence).toEqual(['ran npm test']);
        expect(review.outOfScope).toEqual([]);
    });

    it('a file named by a step matches by its tail or its folder', () => {
        const review = reviewPlan('p', ['Edit cart.ts', 'Move helpers into lib/'], { files: ['packages/app/src/cart.ts', 'lib/helpers.ts'], commands: [] });
        expect(review.steps.map(s => s.state)).toEqual(['matched', 'matched']);
    });

    it('writes the review into the plan file', () => {
        const review = reviewPlan('p', STEPS, { files: ['src/cart.ts', 'other.ts'], commands: [] });
        const text = reviewMarkdown(review, 'now');
        expect(text).toContain('## Review (now)');
        expect(text).toContain('- [x] Fix the rounding in `src/cart.ts` (src/cart.ts)');
        expect(text).toContain('- [ ] Run the unit tests (missing)');
        expect(text).toContain('Out of scope:\n- `other.ts`');
    });
});

describe('IDEA-306 templates', () => {
    it('generalizes steps into a reusable template', () => {
        expect(generalizeStep('Fix the rounding in `src/cart.ts`')).toBe('Fix the rounding in <file>');
        expect(generalizeStep('Rename `getUser` in src/user.ts')).toBe('Rename <name> in <file>');
        expect(planTemplate(STEPS)).toBe('Fix the rounding in <file>\nAdd a regression test in <file>\nUpdate the checkout copy\nRun the unit tests');
        expect(templatePrompt('bugfix', 'Reproduce\nFix <file>')).toContain('bug fix tasks');
        expect(templatePrompt('bugfix', 'Reproduce\nFix <file>')).toContain('- Fix <file>');
    });
});
