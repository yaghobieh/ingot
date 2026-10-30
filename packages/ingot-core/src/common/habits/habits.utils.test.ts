import { describe, expect, it } from 'vitest';
import { addStopHook, commandEvidence, habitFile, habitTargets, habitTitle, instructionEvidence, parseHabits, recordEvidence, rejectionEvidence, serializeHabits, terminalInput } from './habits.utils';
import type { Habit } from './habits.types';

describe('IDEA-296 habits', () => {
    it('finds repeated instructions in prompts, ignoring filler and plain requests', () => {
        const found = instructionEvidence('Add a settings page. Please use Bear components! Also `use Bear components`.\nNever add comments');
        expect(found.map(e => e.key)).toEqual(['instruction:use bear components', 'instruction:never add comments']);
        expect(found[0]).toMatchObject({ kind: 'instruction', label: 'use Bear components', text: 'Use Bear components.' });
        expect(instructionEvidence('Fix the bug in index.ts')).toEqual([]);
    });

    it('counts commands and rejected styles', () => {
        expect(commandEvidence('npm   run lint')).toMatchObject({ key: 'command:npm run lint', text: 'Run `npm run lint` in the project root and report the result.' });
        expect(commandEvidence('ls -la')).toBeUndefined();
        expect(commandEvidence('git status')).toBeUndefined();
        const rejected = rejectionEvidence(['const a: any = 1;', '  console.log(a);'], 'src/a.ts');
        expect(rejected.map(e => e.key)).toEqual(['rejection:console-log', 'rejection:any-type']);
        expect(rejected[0].example).toBe('src/a.ts: console.log(a);');
    });

    it('proposes a habit once it reaches the threshold, and leaves turned-off habits alone', () => {
        const [e] = instructionEvidence('Use Bear components.');
        let habits: Habit[] = [];
        let proposed: Habit | undefined;
        for (let i = 1; i <= 3; i++) {
            ({ habits, proposed } = recordEvidence(habits, { ...e, example: `prompt ${i}` }, i, 3));
            expect(!!proposed).toBe(i === 3);
        }
        expect(habits[0]).toMatchObject({ id: 'instruction-use-bear-components', count: 3, status: 'proposed', examples: ['prompt 1', 'prompt 2', 'prompt 3'], firstSeen: 1, lastSeen: 3 });
        expect(recordEvidence(habits, e, 4, 3).proposed).toBeUndefined();
        const off = recordEvidence([{ ...habits[0], enabled: false }], e, 5, 3).habits[0];
        expect(off.count).toBe(3);
        expect(parseHabits(serializeHabits(habits))).toEqual(habits);
        expect(parseHabits('{')).toEqual([]);
    });

    it('turns a habit into a rule, a command or a stop hook', () => {
        const habit = { kind: 'instruction' as const, label: 'use Bear components', text: 'Use Bear components.', count: 3 };
        expect(habitTitle(habit)).toBe('You often ask to use Bear components.');
        expect(habitTargets(habit)).toEqual(['rule', 'command']);
        expect(habitFile(habit, 'rule')).toEqual({ path: '.ingot/rules/use-bear-components.md', content: '---\ndescription: Learned habit: ask to use Bear components\nalwaysApply: true\n---\nUse Bear components.\n' });
        expect(habitFile(habit, 'command').path).toBe('.ingot/commands/use-bear-components.md');
        expect(habitFile({ kind: 'rejection', label: 'add console.log calls', text: 'x', count: 3 }, 'rule').path).toBe('.ingot/rules/no-add-console-log-calls.md');
        expect(habitTitle({ kind: 'command', label: 'npm test' })).toBe('You often run `npm test`.');
        expect(habitTargets({ kind: 'command' })).toEqual(['command', 'hook', 'rule']);
        const hooks = JSON.parse(addStopHook(JSON.stringify({ 'pre-commit': ['lint'], hooks: { stop: [{ command: 'a' }] } }), 'npm test'));
        expect(hooks).toEqual({ version: 1, 'pre-commit': ['lint'], hooks: { stop: [{ command: 'a' }, { command: 'npm test' }] } });
        expect(JSON.parse(addStopHook(undefined, 'npm test')).hooks.stop).toEqual([{ command: 'npm test' }]);
        expect(JSON.parse(addStopHook(JSON.stringify(hooks), 'npm test')).hooks.stop.length).toBe(2);
    });
});

describe('IDEA-296 terminal input', () => {
    it('collects typed lines, with backspace, and drops history recalls', () => {
        let state = terminalInput('', 'npm tesx\x7ft');
        expect(state.lines).toEqual([]);
        state = terminalInput(state.buffer, '\r');
        expect(state.lines).toEqual(['npm test']);
        expect(terminalInput('', '\x1b[A\r').lines).toEqual([]);
        expect(terminalInput('', 'git pu\tsh\r').lines).toEqual([]);
        expect(terminalInput('', 'a\x03npm run lint\rnpm run build\r').lines).toEqual(['npm run lint', 'npm run build']);
    });
});
