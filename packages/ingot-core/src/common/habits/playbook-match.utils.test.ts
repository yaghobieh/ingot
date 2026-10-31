import { describe, expect, it } from 'vitest';
import { bestPlaybook, keywordMatches, matchPlaybooks, terminalErrorLines } from './playbook-match.utils';
import type { HabitSignals, Playbook } from './playbook.types';

const playbook = (over: Partial<Playbook>): Playbook => ({
    id: `project:${over.slug ?? 'x'}`, name: 'X', slug: 'x', when: 'x', globs: [], keywords: [], steps: ['a'], allowedTools: [], doneCriteria: [], notes: '',
    source: 'project', path: '.ingot/habits/x.md', ...over
});

const signals = (over: Partial<HabitSignals>): HabitSignals => ({ prompt: '', files: [], diagnostics: [], terminalErrors: [], ...over });

const payments = playbook({ name: 'Payments bug', slug: 'payments-bug', keywords: ['payment', 'checkout'], globs: ['src/payments/**'], errorRegex: 'PaymentError' });
const flaky = playbook({ name: 'Flaky e2e', slug: 'flaky-e2e', keywords: ['flaky'], globs: ['e2e/**'] });
const styles = playbook({ name: 'Styles', slug: 'styles', globs: ['**/*.css'] });

describe('keywordMatches', () => {
    it('matches whole words and phrases with plural / verb endings', () => {
        expect(keywordMatches('payment', 'the Payments page is broken')).toBe(true);
        expect(keywordMatches('payment', 'prepayment')).toBe(false);
        expect(keywordMatches('card declined', 'card   declined again')).toBe(true);
        expect(keywordMatches('c++', 'a c++ build')).toBe(true);
    });
});

describe('matchPlaybooks', () => {
    it('picks a habit from prompt keywords', () => {
        const match = bestPlaybook([payments, flaky], signals({ prompt: 'Bug in payments: checkout spins forever' }));
        expect(match?.playbook).toBe(payments);
        expect(match?.reasons).toEqual(['keyword "payment"', 'keyword "checkout"']);
    });

    it('picks a habit from an error in diagnostics or the terminal, even without keywords', () => {
        expect(bestPlaybook([payments, flaky], signals({ prompt: 'fix it', diagnostics: [{ path: 'src/a.ts', message: 'PaymentError: declined' }] }))?.reasons).toEqual(['error in diagnostics']);
        expect(bestPlaybook([payments], signals({ prompt: 'why?', terminalErrors: ['Uncaught PaymentError at charge()'] }))?.reasons).toEqual(['error in terminal']);
        expect(bestPlaybook([payments], signals({ prompt: 'see', attachments: 'stack: PaymentError' }))?.reasons).toEqual(['error in attachment']);
    });

    it('does not pick a keyword habit from a matching file alone, but a globs-only habit does match', () => {
        expect(bestPlaybook([payments], signals({ prompt: 'rename this', files: ['src/payments/api.ts'] }))).toBeUndefined();
        expect(bestPlaybook([styles], signals({ prompt: 'tweak', files: ['src/app.css'] }))?.reasons).toEqual(['file src/app.css']);
    });

    it('adds file evidence to the score and ranks the stronger match first', () => {
        const ranked = matchPlaybooks([flaky, payments], signals({ prompt: 'flaky payment test', files: ['src/payments/api.ts'] }));
        expect(ranked.map(m => m.playbook.name)).toEqual(['Payments bug', 'Flaky e2e']);
        expect(ranked[0].score).toBeGreaterThan(ranked[1].score);
    });

    it('ignores an invalid errorRegex instead of throwing', () => {
        expect(bestPlaybook([playbook({ errorRegex: '(' })], signals({ prompt: '(' }))).toBeUndefined();
    });
});

describe('terminalErrorLines', () => {
    it('keeps error-looking lines only', () => {
        expect(terminalErrorLines('$ npm test\n ok 1\nError: PaymentError thrown\nFAILED 2 tests\n')).toEqual(['Error: PaymentError thrown', 'FAILED 2 tests']);
    });
});
