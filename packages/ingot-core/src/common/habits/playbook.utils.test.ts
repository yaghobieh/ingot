import { describe, expect, it } from 'vitest';
import {
    activeHabit, doneNudge, findPlaybook, formatActiveHabit, formatHabitIndex, habitMarks, habitProgress, habitToolAllowed, parsePlaybook, playbookFileName,
    playbookFileText, refreshHabit, stripHabitMarks, tickCommand, tickHabit
} from './playbook.utils';
import type { Playbook } from './playbook.types';

const PAYMENTS = `---
name: Payments bug
when: A bug or failure in the payments flow
keywords: [payments, checkout]
globs:
  - src/payments/**
errorRegex: "PaymentError|card_declined"
steps:
  1. Search logs/payments.log for the error
  2. Check the payments service with \`npm run check:payments\`
  3. Run \`npm test -- payments\`
allowedTools: [read_file, grep, run]
doneCriteria:
  - \`npm test -- payments\` passes
  - The root cause is named in the reply
---
Ask in #payments if the service is down.
`;

const file = { path: '.ingot/habits/payments-bug.md', source: 'project' as const };

const parse = (text: string): Playbook => {
    const result = parsePlaybook(text, file);
    expect(result.errors).toEqual([]);
    return result.playbook!;
};

describe('parsePlaybook', () => {
    it('reads every frontmatter key, ordered steps and the notes', () => {
        const p = parse(PAYMENTS);
        expect(p).toMatchObject({
            id: 'project:payments-bug', name: 'Payments bug', slug: 'payments-bug', when: 'A bug or failure in the payments flow',
            keywords: ['payments', 'checkout'], globs: ['src/payments/**'], errorRegex: 'PaymentError|card_declined',
            allowedTools: ['read_file', 'grep', 'run'], notes: 'Ask in #payments if the service is down.', source: 'project'
        });
        expect(p.steps).toEqual(['Search logs/payments.log for the error', 'Check the payments service with `npm run check:payments`', 'Run `npm test -- payments`']);
        expect(p.doneCriteria).toEqual(['`npm test -- payments` passes', 'The root cause is named in the reply']);
    });

    it('names the habit after its file when name is missing', () => {
        expect(parse('---\nwhen: flaky e2e\nsteps:\n  - rerun once\n---\n').name).toBe('Payments bug');
    });

    it('explains what is missing or wrong', () => {
        expect(parsePlaybook('just text', file).errors[0]).toMatch(/No frontmatter/);
        const missing = parsePlaybook('---\nname: x\n---\n', file);
        expect(missing.playbook).toBeUndefined();
        expect(missing.errors.join('\n')).toMatch(/"when" is required/);
        expect(missing.errors.join('\n')).toMatch(/"steps" needs at least one step/);
        const bad = parsePlaybook('---\nwhen: x\nsteps:\n  - a\nerrorRegex: "(unclosed"\nallowedTools: [read file]\nsteps2: y\n---\n', file);
        expect(bad.errors.join('\n')).toMatch(/"errorRegex" is not a valid regular expression/);
        expect(bad.errors.join('\n')).toMatch(/"allowedTools" has invalid names: read file/);
        expect(bad.warnings[0]).toMatch(/Unknown key "steps2"/);
        expect(parsePlaybook('---\nwhen: x\nsteps: true\n---\n', file).errors[0]).toMatch(/"steps" must be a list/);
    });
});

describe('playbookFileText', () => {
    it('round-trips through the parser, including globs with commas and regexes that start with [', () => {
        const draft = {
            name: 'Flaky UI test', when: 'An e2e test fails: sometimes', globs: ['src/**/*.{ts,tsx}'], keywords: ['flaky', 'e2e'], errorRegex: '[Tt]imeout',
            steps: ['Rerun `npx playwright test --repeat-each=3`', 'true'], allowedTools: ['run', 'github/*'], doneCriteria: ['Passes 3 times'], notes: 'Notes here.'
        };
        const p = parse(playbookFileText(draft));
        expect(p).toMatchObject({ ...draft, globs: ['src/**/*.{ts,tsx}'], steps: draft.steps });
        expect(playbookFileName('Flaky UI test!')).toBe('flaky-ui-test.md');
        expect(playbookFileName('!!!')).toBeUndefined();
    });
});

describe('active habit checklist', () => {
    const p = parse(PAYMENTS);

    it('ticks steps and criteria from markers and hides the markers', () => {
        const reply = 'Found it.\nHABIT-STEP: 1\nHABIT-STEP: 2, 3\nHABIT-DONE: 2\nDone.';
        expect(habitMarks(reply)).toEqual({ steps: [1, 2, 3], done: [2] });
        expect(stripHabitMarks(reply)).toBe('Found it.\n\nDone.');
        const habit = tickHabit(activeHabit(p, 'auto'), habitMarks(reply));
        expect(habit.steps.map(s => s.done)).toEqual([true, true, true]);
        expect(habit.criteria.map(c => c.done)).toEqual([false, true]);
        expect(habitProgress(habit)).toBe('3/3');
    });

    it('ticks a step and a criterion when the named command runs (criteria only when it passes)', () => {
        const failed = tickCommand(activeHabit(p, 'auto'), 'npm test -- payments', false);
        expect(failed.steps[2].done).toBe(true);
        expect(failed.criteria[0].done).toBe(false);
        expect(tickCommand(failed, 'npm  test -- payments', true).criteria[0].done).toBe(true);
        expect(tickCommand(activeHabit(p, 'auto'), 'npm testing', true).steps[2].done).toBe(false);
    });

    it('limits tools to allowedTools, always allowing use_habit and ask_user', () => {
        const habit = activeHabit(p, 'auto');
        expect(habitToolAllowed(habit, 'ingot', 'grep', 'ingot')).toBe(true);
        expect(habitToolAllowed(habit, 'ingot', 'delete', 'ingot')).toBe(false);
        expect(habitToolAllowed(habit, 'ingot', 'use_habit', 'ingot')).toBe(true);
        expect(habitToolAllowed(habit, 'github', 'create_issue', 'ingot')).toBe(false);
        expect(habitToolAllowed({ ...habit, allowedTools: ['github/*'] }, 'github', 'create_issue', 'ingot')).toBe(true);
        expect(habitToolAllowed({ ...habit, off: true }, 'ingot', 'delete', 'ingot')).toBe(true);
        expect(habitToolAllowed(undefined, 'ingot', 'delete', 'ingot')).toBe(true);
    });

    it('reminds once about open done criteria', () => {
        const habit = activeHabit(p, 'auto');
        expect(doneNudge(habit)).toContain('1. `npm test -- payments` passes');
        expect(doneNudge({ ...habit, nudged: 1 })).toBeUndefined();
        expect(doneNudge(tickHabit(habit, { steps: [], done: [1, 2] }))).toBeUndefined();
    });

    it('keeps ticks for unchanged steps when the habit file changes', () => {
        const ticked = tickHabit(activeHabit(p, 'auto'), { steps: [1], done: [] });
        const edited = { ...p, steps: [p.steps[0], 'New step'] };
        expect(refreshHabit(ticked, edited).steps).toEqual([{ text: p.steps[0], done: true }, { text: 'New step', done: false }]);
    });

    it('formats the index and the active habit for the system prompt', () => {
        expect(formatHabitIndex([p], 'ingot/use_habit')).toContain('- Payments bug: A bug or failure in the payments flow');
        expect(formatHabitIndex([], 'ingot/use_habit')).toBe('');
        const text = formatActiveHabit(tickHabit(activeHabit(p, 'auto'), { steps: [1], done: [] }), p.notes);
        expect(text).toContain('1. [x] Search logs/payments.log');
        expect(text).toContain('only these tools may be called: read_file, grep, run');
        expect(text).toContain('HABIT-STEP: <n>');
        expect(findPlaybook([p], 'payments bug')).toBe(p);
        expect(findPlaybook([p], 'payments-bug')).toBe(p);
    });
});
