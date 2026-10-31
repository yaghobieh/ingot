import { describe, expect, it } from 'vitest';
import { draftFromLearned, draftFromRun, errorRegexFrom, promptKeywords, runSummary } from './playbook-draft.utils';
import { parsePlaybook, playbookFileText } from './playbook.utils';
import type { AgentMessage, AgentStep } from '../agents/agents.types';

const tool = (name: string, args: Record<string, unknown>, state: 'done' | 'error' = 'done'): AgentMessage => ({
    role: 'tool', from: `ingot/${name}`, text: '', tool: { server: 'ingot', tool: name, args, state, startedAt: 1, endedAt: 2 }
});

const messages: AgentMessage[] = [
    { role: 'user', text: 'old prompt' },
    { role: 'agent', text: 'old answer' },
    { role: 'user', text: 'Bug in payments: checkout throws PaymentError for saved cards' },
    tool('grep', { pattern: 'PaymentError', path: 'src' }),
    tool('read_file', { path: 'src/payments/charge.ts' }),
    tool('read_file', { path: 'src/payments/cards.ts' }),
    tool('ask_user', { question: 'Which card?' }),
    tool('run', { command: 'npm test -- payments' }, 'error'),
    { role: 'user', text: 'Before you finish…', hidden: true },
    tool('run', { command: 'npm test -- payments' }),
    { role: 'agent', text: 'Fixed.' }
];
const steps: AgentStep[] = [{ kind: 'edit', target: 'src/payments/charge.ts', done: true }];

describe('runSummary', () => {
    it('takes the last visible prompt, its tool calls in order and the edited files', () => {
        const run = runSummary(messages, steps)!;
        expect(run.prompt).toBe('Bug in payments: checkout throws PaymentError for saved cards');
        expect(run.actions.map(a => `${a.tool}:${a.ok}`)).toEqual(['grep:true', 'read_file:true', 'read_file:true', 'ask_user:true', 'run:false', 'run:true']);
        expect(run.edits).toEqual(['src/payments/charge.ts']);
        expect(runSummary([], [])).toBeUndefined();
    });
});

describe('draftFromRun', () => {
    it('drafts a valid habit from the prompt, the steps taken and the files and commands', () => {
        const draft = draftFromRun(runSummary(messages, steps)!);
        expect(draft.name).toBe('Bug in payments');
        expect(draft.when).toBe('Tasks like: Bug in payments: checkout throws PaymentError for saved cards');
        expect(draft.keywords).toEqual(['payments', 'checkout', 'throws', 'paymenterror', 'saved']);
        expect(draft.errorRegex).toBe('PaymentError');
        expect(draft.globs).toEqual(['src/payments/**']);
        expect(draft.steps).toEqual([
            'Search the code for `PaymentError` in `src`',
            'Read `src/payments/charge.ts`, `src/payments/cards.ts`',
            'Make the fix in `src/payments/charge.ts`',
            'Run `npm test -- payments`'
        ]);
        expect(draft.allowedTools).toEqual(['grep', 'read_file', 'run']);
        expect(draft.doneCriteria).toEqual(['`npm test -- payments` passes']);
        const parsed = parsePlaybook(playbookFileText(draft), { path: '.ingot/habits/bug-in-payments.md', source: 'project' });
        expect(parsed.errors).toEqual([]);
        expect(parsed.playbook?.steps).toEqual(draft.steps);
    });

    it('falls back to generic steps and criteria for a run without tools', () => {
        const draft = draftFromRun({ prompt: 'explain the build', actions: [], edits: [] });
        expect(draft.steps).toEqual(['Reproduce the problem', 'Make the fix', 'Verify the fix']);
        expect(draft.doneCriteria).toEqual(['The original problem is fixed and the change is reviewed']);
        expect(draft.globs).toEqual([]);
    });

    it('finds error names and keywords in prompts', () => {
        expect(errorRegexFrom('ENOENT and a TypeError, then TypeError again')).toBe('ENOENT|TypeError');
        expect(promptKeywords('Please check @src/a.ts and `code` the flaky e2e login test, login again')).toEqual(['flaky', 'login', 'test']);
    });
});

describe('draftFromLearned', () => {
    it('turns a learned command, instruction or rejected style into a valid habit', () => {
        for (const habit of [
            { kind: 'command' as const, label: 'npm test', text: 'Run `npm test`.', examples: [] },
            { kind: 'instruction' as const, label: 'use Bear components', text: 'Use Bear components.', examples: [] },
            { kind: 'rejection' as const, label: 'add console.log calls', text: 'Do not add console.log or console.debug calls.', examples: [] }
        ]) {
            const draft = draftFromLearned(habit);
            expect(parsePlaybook(playbookFileText(draft), { path: 'x.md', source: 'project' }).errors).toEqual([]);
        }
        expect(draftFromLearned({ kind: 'command', label: 'npm test', text: '', examples: [] }).doneCriteria).toEqual(['`npm test` passes']);
    });
});
