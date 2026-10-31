import { slugify } from '../project-config/project-config.utils';
import {
    COMMAND_MAX_CHARS, COMMAND_MIN_CHARS, HABIT_NOTE_LEARNED_PREFIX, HABITS_FILE_VERSION, INSTRUCTION_FILLER, INSTRUCTION_MAX_CHARS, INSTRUCTION_MAX_WORDS,
    INSTRUCTION_MIN_CHARS, INSTRUCTION_START, LEARNED_FOCUS_PREFIX, MAX_EXAMPLE_CHARS, MAX_HABIT_EXAMPLES, MAX_HABITS, REJECTION_PATTERNS, TRIVIAL_COMMANDS
} from './habits.consts';
import type { Habit, HabitEvidence, HabitFile, HabitNote, HabitsFile, HabitTarget, HabitUndo } from './habits.types';

const clip = (text: string): string => {
    const flat = text.replace(/\s+/g, ' ').trim();
    return flat.length > MAX_EXAMPLE_CHARS ? `${flat.slice(0, MAX_EXAMPLE_CHARS - 1)}…` : flat;
};

const sentence = (text: string): string => {
    const clean = text.trim().replace(/[.!;]+$/, '');
    return `${clean.charAt(0).toUpperCase()}${clean.slice(1)}.`;
};

/** Imperative sentences in a prompt ("Use Bear components."), one evidence per distinct instruction. */
export const instructionEvidence = (prompt: string): HabitEvidence[] => {
    const seen = new Set<string>();
    return prompt.split(/(?<=[.!?;])\s+|\n+/).flatMap(raw => {
        let text = raw.trim().replace(/^[-*>\d.)\s]+/, '');
        while (INSTRUCTION_FILLER.test(text)) {
            text = text.replace(INSTRUCTION_FILLER, '');
        }
        text = text.replace(/[`"'“”]/g, '').replace(/[.!?;,]+$/, '').replace(/\s+/g, ' ').trim();
        if (!INSTRUCTION_START.test(text) || text.length < INSTRUCTION_MIN_CHARS || text.length > INSTRUCTION_MAX_CHARS || text.split(' ').length > INSTRUCTION_MAX_WORDS) {
            return [];
        }
        const key = `instruction:${text.toLowerCase()}`;
        if (seen.has(key)) {
            return [];
        }
        seen.add(key);
        return [{ kind: 'instruction' as const, key, label: text, text: sentence(text), example: clip(prompt) }];
    });
};

/** A terminal command worth counting (trivial ones like `ls` or `git status` are not). */
export const commandEvidence = (command: string): HabitEvidence | undefined => {
    const text = command.replace(/\s+/g, ' ').trim();
    if (text.length < COMMAND_MIN_CHARS || text.length > COMMAND_MAX_CHARS || TRIVIAL_COMMANDS.some(re => re.test(text))) {
        return undefined;
    }
    return { kind: 'command', key: `command:${text}`, label: text, text: `Run \`${text}\` in the project root and report the result.`, example: text };
};

/** Styles in rejected agent lines (console.log, `any`, default exports…). */
export const rejectionEvidence = (addedLines: readonly string[], path: string): HabitEvidence[] =>
    REJECTION_PATTERNS.flatMap(pattern => {
        const line = addedLines.find(l => pattern.test.test(l));
        return line ? [{ kind: 'rejection' as const, key: `rejection:${pattern.id}`, label: pattern.label, text: pattern.rule, example: clip(`${path}: ${line}`) }] : [];
    });

/**
 * Counts one observation. A habit that reaches `threshold` while still learning becomes `proposed` (returned so the
 * chat can show its card). Habits turned off are left alone.
 */
export const recordEvidence = (habits: readonly Habit[], evidence: HabitEvidence, now: number, threshold: number): { habits: Habit[]; proposed?: Habit } => {
    const existing = habits.find(h => h.key === evidence.key);
    if (existing && !existing.enabled) {
        return { habits: [...habits] };
    }
    const base: Habit = existing ?? {
        id: slugify(evidence.key.replace(':', '-')) || `habit-${now}`, kind: evidence.kind, key: evidence.key, label: evidence.label, text: evidence.text,
        count: 0, examples: [], enabled: true, status: 'learning', firstSeen: now, lastSeen: now
    };
    const examples = [...base.examples.filter(e => e !== evidence.example), evidence.example].slice(-MAX_HABIT_EXAMPLES);
    const count = base.count + 1;
    const proposes = base.status === 'learning' && count >= threshold;
    const next: Habit = { ...base, count, examples, lastSeen: now, status: proposes ? 'proposed' : base.status };
    let list = existing ? habits.map(h => h === existing ? next : h) : [...habits, next];
    if (list.length > MAX_HABITS) {
        const drop = list.filter(h => h.status === 'learning' && h !== next).sort((a, b) => a.lastSeen - b.lastSeen)[0];
        list = list.filter(h => h !== drop);
    }
    return { habits: list, ...(proposes ? { proposed: next } : {}) };
};

/** The card's question: "You often ask to use Bear components." */
export const habitTitle = (habit: Pick<Habit, 'kind' | 'label'>): string =>
    habit.kind === 'instruction' ? `You often ask to ${habit.label.charAt(0).toLowerCase()}${habit.label.slice(1)}.`
        : habit.kind === 'command' ? `You often run \`${habit.label}\`.`
            : `You often reject edits that ${habit.label}.`;

/** What a habit can become: rules for instructions and rejected styles, commands (and hooks) for terminal commands. */
export const habitTargets = (habit: Pick<Habit, 'kind'>): HabitTarget[] =>
    habit.kind === 'command' ? ['command', 'hook', 'rule'] : ['rule', 'command'];

/** The rule or command file a habit becomes (`hook` is merged into hooks.json by `addStopHook`). */
export const habitFile = (habit: Pick<Habit, 'kind' | 'label' | 'text' | 'count'>, target: Exclude<HabitTarget, 'hook'>): HabitFile => {
    const slug = slugify(habit.kind === 'rejection' ? `no-${habit.label}` : habit.label) || 'habit';
    const description = `Learned habit: ${habit.kind === 'command' ? habit.label : habitTitle({ kind: habit.kind, label: habit.label }).replace(/^You often /, '').replace(/\.$/, '')}`;
    if (target === 'rule') {
        return { path: `.ingot/rules/${slug}.md`, content: `---\ndescription: ${description}\nalwaysApply: true\n---\n${habit.text}\n` };
    }
    return { path: `.ingot/commands/${slug}.md`, content: `---\ndescription: ${description}\n---\n${habit.text}\n\n$ARGUMENTS\n` };
};

const readHooks = (text: string | undefined): { json: Record<string, unknown>; hooks: Record<string, unknown>; stop: unknown[] } => {
    let json: Record<string, unknown> = {};
    try {
        const parsed = text?.trim() ? JSON.parse(text) as unknown : {};
        json = parsed && typeof parsed === 'object' && !Array.isArray(parsed) ? parsed as Record<string, unknown> : {};
    } catch {
        json = {};
    }
    const hooks = json.hooks && typeof json.hooks === 'object' && !Array.isArray(json.hooks) ? json.hooks as Record<string, unknown> : {};
    return { json, hooks, stop: Array.isArray(hooks.stop) ? hooks.stop : [] };
};

const stopCommand = (entry: unknown): unknown => typeof entry === 'string' ? entry : (entry as { command?: unknown })?.command;

/** Whether the `stop` agent hook of a hooks.json text already runs `command`. */
export const hasStopHook = (text: string | undefined, command: string): boolean => readHooks(text).stop.some(e => stopCommand(e) === command);

/** Adds a command to the `stop` agent hook of a hooks.json text (keeps git stages and other events). */
export const addStopHook = (text: string | undefined, command: string): string => {
    const { json, hooks, stop } = readHooks(text);
    const exists = stop.some(e => stopCommand(e) === command);
    return `${JSON.stringify({ version: 1, ...json, hooks: { ...hooks, stop: exists ? stop : [...stop, { command }] } }, undefined, 2)}\n`;
};

/** Takes a command back out of the `stop` agent hook (Undo of "Make it a hook"); an emptied `stop` list is dropped. */
export const removeStopHook = (text: string | undefined, command: string): string => {
    const { json, hooks, stop } = readHooks(text);
    const rest = stop.filter(e => stopCommand(e) !== command);
    const others = Object.fromEntries(Object.entries(hooks).filter(([event]) => event !== 'stop'));
    return `${JSON.stringify({ ...json, hooks: rest.length ? { ...others, stop: rest } : others }, undefined, 2)}\n`;
};

export const learnedFocus = (habitId: string): string => `${LEARNED_FOCUS_PREFIX}${habitId}`;

/** The muted text after "Saved to Habits": `Learned: npm test` or `use Bear components → .ingot/rules/use-bear-components.md`. */
export const habitNoteDetail = (note: Pick<HabitNote, 'kind' | 'label' | 'savedAs'>): string =>
    note.kind === 'learned' ? `${HABIT_NOTE_LEARNED_PREFIX} ${note.label}` : note.savedAs ? `${note.label} → ${note.savedAs}` : note.label;

/** The learned patterns after Undo: the pattern as it was before the note, or without it when it was new. */
export const undoHabits = (habits: readonly Habit[], undo: HabitUndo): Habit[] => {
    if (!undo.habitId) {
        return [...habits];
    }
    const previous = undo.previous;
    return previous ? habits.map(h => h.id === undo.habitId ? previous : h) : habits.filter(h => h.id !== undo.habitId);
};

export const parseHabits = (text: string | undefined): Habit[] => {
    if (!text?.trim()) {
        return [];
    }
    try {
        const json = JSON.parse(text) as Partial<HabitsFile>;
        return Array.isArray(json.habits)
            ? json.habits.filter((h): h is Habit => !!h && typeof h.key === 'string' && typeof h.label === 'string' && typeof h.count === 'number')
            : [];
    } catch {
        return [];
    }
};

export const serializeHabits = (habits: readonly Habit[]): string => `${JSON.stringify({ version: HABITS_FILE_VERSION, habits }, undefined, 2)}\n`;

/** Index of the last character of the escape sequence starting at `start` (CSI `ESC [ … final`, SS3 `ESC O x`, or `ESC x`). */
const escapeEnd = (data: string, start: number): number => {
    const kind = data[start + 1];
    if (kind === '[') {
        let i = start + 2;
        while (i < data.length && !(data[i] >= '@' && data[i] <= '~')) {
            i++;
        }
        return Math.min(i, data.length - 1);
    }
    return Math.min(start + (kind === 'O' ? 2 : 1), data.length - 1);
};

/**
 * Feeds terminal keystrokes (xterm `onData`) into a line buffer and returns the lines entered with Enter.
 * Escape sequences (arrows, history recall) make the line unknown (`undefined` buffer) until the next Enter.
 */
export const terminalInput = (buffer: string | undefined, data: string): { buffer: string | undefined; lines: string[] } => {
    let line = buffer;
    const lines: string[] = [];
    for (let i = 0; i < data.length; i++) {
        const ch = data[i];
        if (ch === '\r' || ch === '\n') {
            if (line?.trim()) {
                lines.push(line.trim());
            }
            line = '';
        } else if (ch === '\x7f' || ch === '\b') {
            line = line?.slice(0, -1);
        } else if (ch === '\x03' || ch === '\x15') {
            line = '';
        } else if (ch === '\x1b' || ch === '\t') {
            line = undefined;
            if (ch === '\x1b') {
                i = escapeEnd(data, i);
            }
        } else if (ch >= ' ' && line !== undefined) {
            line += ch;
        }
    }
    return { buffer: line, lines };
};
