import { describe, expect, it } from 'vitest';
import {
    addStopHook, commandEvidence, habitFile, habitNoteDetail, habitTargets, habitTitle, hasStopHook, instructionEvidence, learnedFocus, parseHabits, recordEvidence,
    rejectionEvidence, removeStopHook, saveHabit, savedHabitFocus, savedHabitKey, serializeHabits, terminalInput, undoHabits
} from './habits.utils';
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

    it('IDEA-302..304: records habits a feature already saved, counting repeats', () => {
        const saved = { kind: 'frozen' as const, key: 'frozen:src/legacy.ts', label: 'src/legacy.ts', text: 'Freeze src/legacy.ts.', example: 'rejected 3 edits', savedAs: '.ingot/frozen.json' };
        let { habits, habit } = saveHabit([], saved, 1);
        expect(habit).toMatchObject({ id: 'frozen-src-legacy-ts', kind: 'frozen', status: 'accepted', count: 1, enabled: true, savedAs: '.ingot/frozen.json', examples: ['rejected 3 edits'] });
        ({ habits, habit } = saveHabit([{ ...habits[0], enabled: false }], { ...saved, example: 'again' }, 2));
        expect(habits).toHaveLength(1);
        expect(habit).toMatchObject({ count: 2, enabled: false, lastSeen: 2, examples: ['rejected 3 edits', 'again'] });
        expect(habitTitle({ kind: 'frozen', label: 'src/legacy.ts' })).toBe('You always revert edits to src/legacy.ts.');
        expect(habitTitle({ kind: 'decision', label: 'Use pnpm, not npm' })).toBe('You keep confirming: Use pnpm, not npm.');
        expect(habitTitle({ kind: 'anti', label: 'Editing math.js' })).toBe("Don't do this here: Editing math.js.");
    });
});

describe('IDEA-296 "Saved to Habits" notes', () => {
    const learned: Habit = {
        id: 'command-npm-test', kind: 'command', key: 'command:npm test', label: 'npm test', text: 'Run `npm test`.', count: 3, examples: ['npm test'],
        enabled: true, status: 'proposed', firstSeen: 1, lastSeen: 3
    };

    it('describes what was learned or saved', () => {
        expect(habitNoteDetail({ kind: 'learned', label: 'npm test' })).toBe('Learned: npm test');
        expect(habitNoteDetail({ kind: 'saved', label: 'npm test', savedAs: '.ingot/commands/npm-test.md' })).toBe('npm test → .ingot/commands/npm-test.md');
        expect(habitNoteDetail({ kind: 'saved', label: 'Release build broken' })).toBe('Release build broken');
        expect(learnedFocus('command-npm-test')).toBe('learned:command-npm-test');
    });

    it('a habit a feature saved opens on the same Habits row saveHabit writes', () => {
        const key = savedHabitKey('frozen', 'src/legacy.ts');
        expect(key).toBe('frozen:src/legacy.ts');
        const { habit } = saveHabit([], { kind: 'frozen', key, label: 'src/legacy.ts', text: 'Freeze it.', example: 'x', savedAs: '.ingot/frozen.json' }, 1);
        expect(savedHabitFocus(key)).toBe(learnedFocus(habit.id));
    });

    it('Undo forgets a new pattern and puts a saved one back as it was', () => {
        const saved: Habit = { ...learned, status: 'accepted', savedAs: '.ingot/commands/npm-test.md' };
        const other: Habit = { ...learned, id: 'other', key: 'command:other' };
        expect(undoHabits([learned, other], { habitId: learned.id })).toEqual([other]);
        expect(undoHabits([saved, other], { habitId: learned.id, previous: learned })).toEqual([learned, other]);
        expect(undoHabits([saved], { playbook: 'file:///p/.ingot/habits/x.md' })).toEqual([saved]);
    });

    it('takes an added stop hook back out and keeps the rest of hooks.json', () => {
        const before = JSON.stringify({ version: 1, hooks: { stop: [{ command: 'a' }], beforeShellExecution: [{ command: 'guard' }] } });
        expect(hasStopHook(before, 'npm test')).toBe(false);
        const added = addStopHook(before, 'npm test');
        expect(hasStopHook(added, 'npm test')).toBe(true);
        expect(JSON.parse(removeStopHook(added, 'npm test'))).toEqual(JSON.parse(before));
        const only = removeStopHook(addStopHook(undefined, 'npm test'), 'npm test');
        expect(JSON.parse(only)).toEqual({ version: 1, hooks: {} });
        expect(hasStopHook('not json', 'npm test')).toBe(false);
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
