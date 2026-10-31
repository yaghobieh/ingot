import { describe, expect, it } from 'vitest';
import { createSpecFiles, docTitle, findTask, nextOpenTask, parseTasks, setTaskDone, specProgress, specSlug, summarizeSpec, taskPrompt } from './specs.utils';

const TASKS = `# Implementation plan: Checkout

- [ ] 1. Set up the cart module
  - _Requirements: 1_
- [ ] 2. Payments
  - [x] 2.1 Card form
    - _Requirements: 1.1, 1.2_
  - [ ] 2.2 Receipt email
- [ ] Ship it

\`\`\`md
- [ ] 9. not a task (in a code block)
\`\`\`
`;

describe('specs', () => {
    it('creates the three Kiro-style docs under .ingot/specs/<slug>', () => {
        const { slug, files } = createSpecFiles('Checkout Flow', 'Guests can pay with a card.');
        expect(slug).toBe('checkout-flow');
        expect(files.map(f => f.path)).toEqual(['.ingot/specs/checkout-flow/requirements.md', '.ingot/specs/checkout-flow/design.md', '.ingot/specs/checkout-flow/tasks.md']);
        expect(files[0].content).toContain('Guests can pay with a card.');
        expect(files[0].content).toContain('WHEN <event> THEN the system SHALL');
        expect(parseTasks(files[2].content).length).toBeGreaterThan(3);
        expect(() => createSpecFiles('!!!')).toThrow();
        expect(specSlug('  Ünïcode / Spec!! ')).toBe('n-code-spec');
    });

    it('parses tasks with ids, depth and requirement refs, skipping code blocks', () => {
        const tasks = parseTasks(TASKS);
        expect(tasks.map(t => [t.id, t.depth, t.done])).toEqual([['1', 0, false], ['2', 0, false], ['2.1', 1, true], ['2.2', 1, false], ['5', 0, false]]);
        expect(findTask(tasks, '2.1.')?.requirements).toEqual(['1.1', '1.2']);
        expect(specProgress(tasks)).toEqual({ done: 1, total: 4 });
        expect(nextOpenTask(tasks)?.id).toBe('1');
        expect(docTitle(TASKS)).toBe('Checkout');
    });

    it('ticks a task off and rolls the parent up and down', () => {
        const done = setTaskDone(TASKS, '2.2', true);
        expect(parseTasks(done).filter(t => t.done).map(t => t.id)).toEqual(['2', '2.1', '2.2']);
        const reopened = setTaskDone(done, '2.1', false);
        expect(parseTasks(reopened).filter(t => t.done).map(t => t.id)).toEqual(['2.2']);
        const parent = setTaskDone(TASKS, '2', true);
        expect(parseTasks(parent).filter(t => t.done).map(t => t.id)).toEqual(['2', '2.1', '2.2']);
        expect(() => setTaskDone(TASKS, '7', true)).toThrow('No task 7');
    });

    it('summarizes a spec and builds the agent prompt for a task', () => {
        const spec = summarizeSpec('checkout', { requirements: '# Requirements: Checkout flow\n', tasks: TASKS });
        expect(spec).toMatchObject({ title: 'Checkout flow', docs: ['requirements', 'tasks'], progress: { done: 1, total: 4 } });
        const prompt = taskPrompt(spec, findTask(spec.tasks, '2')!);
        expect(prompt).toContain('Implement task 2 of the "Checkout flow" spec');
        expect(prompt).toContain('2.2 Receipt email');
        expect(prompt).not.toContain('2.1 Card form');
        expect(prompt).toContain('ingot/spec_task with {"spec": "checkout", "task": "2", "done": true}');
    });
});
