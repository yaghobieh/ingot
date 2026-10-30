import { parseFrontmatter, slugify, type Frontmatter } from '../project-config/project-config.utils';
import {
    ALWAYS_ALLOWED_TOOLS, HABIT_MARK_LINE, MAX_DONE_NUDGES, MAX_PLAYBOOK_NAME_CHARS, MAX_PLAYBOOK_STEPS, PLAYBOOK_FILE_EXT, PLAYBOOK_KEYS, PLAYBOOK_LIST_KEYS,
    PLAYBOOK_TEMPLATE_STEP, TOOL_NAME_PATTERN
} from './playbook.consts';
import type { ActiveHabit, HabitCheck, HabitMarks, HabitPick, Playbook, PlaybookDraft, PlaybookParseResult, PlaybookSource } from './playbook.types';

type ListKey = typeof PLAYBOOK_LIST_KEYS[number];

/** `1. step` / `2) step` in the frontmatter become `- step` so ordered lists parse like bullet lists. */
const normalizeOrderedLists = (text: string): string =>
    text.replace(/^(---\r?\n)([\s\S]*?)(\r?\n---)/, (_, open: string, body: string, close: string) => `${open}${body.replace(/^(\s*)\d+[.)]\s+/gm, '$1- ')}${close}`);

const baseName = (path: string): string => path.replace(/\\/g, '/').split('/').pop()!.replace(/\.(md|mdc)$/i, '');

const titleFromSlug = (slug: string): string => {
    const words = slug.replace(/[-_]+/g, ' ').trim();
    return words ? `${words.charAt(0).toUpperCase()}${words.slice(1)}` : slug;
};

const listOf = (data: Frontmatter['data'], key: ListKey, errors: string[]): string[] => {
    const value = data[key];
    if (value === undefined) {
        return [];
    }
    if (typeof value === 'boolean') {
        errors.push(`"${key}" must be a list (one "- item" per line).`);
        return [];
    }
    const items = Array.isArray(value) ? value : value.split(',');
    return items.map(v => v.trim()).filter(Boolean);
};

/**
 * Reads a habit file: frontmatter `name`, `when` (required), `steps` (required, ordered), optional `globs`, `keywords`,
 * `errorRegex`, `allowedTools` and `doneCriteria`; the Markdown body is kept as notes. Errors say what to fix.
 */
export const parsePlaybook = (text: string, file: { path: string; source: PlaybookSource; uri?: string }): PlaybookParseResult => {
    const errors: string[] = [];
    const warnings: string[] = [];
    if (!/^---\r?\n[\s\S]*?\r?\n---/.test(text)) {
        return { errors: ['No frontmatter: start the file with a --- block that has name, when and steps.'], warnings };
    }
    const { data, body } = parseFrontmatter(normalizeOrderedLists(text));
    const slug = baseName(file.path);
    for (const key of Object.keys(data)) {
        if (!(PLAYBOOK_KEYS as readonly string[]).includes(key)) {
            warnings.push(`Unknown key "${key}" is ignored (known keys: ${PLAYBOOK_KEYS.join(', ')}).`);
        }
    }
    const scalar = (key: 'name' | 'when' | 'errorRegex'): string => {
        const value = data[key];
        if (Array.isArray(value) || typeof value === 'boolean') {
            errors.push(`"${key}" must be plain text.`);
            return '';
        }
        return (value ?? '').trim();
    };
    const name = scalar('name') || titleFromSlug(slug);
    const when = scalar('when');
    const errorRegex = scalar('errorRegex');
    const lists = Object.fromEntries(PLAYBOOK_LIST_KEYS.map(key => [key, listOf(data, key, errors)])) as Record<ListKey, string[]>;
    if (name.length > MAX_PLAYBOOK_NAME_CHARS) {
        errors.push(`"name" is longer than ${MAX_PLAYBOOK_NAME_CHARS} characters.`);
    }
    if (!when && !errors.some(e => e.startsWith('"when"'))) {
        errors.push('"when" is required: describe the scenario in plain words (for example: a bug in the payments flow).');
    }
    if (!lists.steps.length && !errors.some(e => e.startsWith('"steps"'))) {
        errors.push('"steps" needs at least one step (an ordered "- step" list).');
    }
    if (lists.steps.length > MAX_PLAYBOOK_STEPS) {
        errors.push(`"steps" has ${lists.steps.length} steps; keep it to ${MAX_PLAYBOOK_STEPS} or fewer.`);
    }
    if (errorRegex) {
        try {
            new RegExp(errorRegex, 'i');
        } catch (error) {
            errors.push(`"errorRegex" is not a valid regular expression: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
    const badTools = lists.allowedTools.filter(t => !TOOL_NAME_PATTERN.test(t));
    if (badTools.length) {
        errors.push(`"allowedTools" has invalid names: ${badTools.join(', ')} (use read_file, ingot/run, server/tool or server/*).`);
    }
    if (errors.length) {
        return { errors, warnings };
    }
    return {
        playbook: {
            id: `${file.source}:${slug}`, name, slug, when, globs: lists.globs, keywords: lists.keywords, ...(errorRegex ? { errorRegex } : {}),
            steps: lists.steps, allowedTools: lists.allowedTools, doneCriteria: lists.doneCriteria, notes: body, source: file.source, path: file.path,
            ...(file.uri ? { uri: file.uri } : {})
        },
        errors, warnings
    };
};

/** A scalar the frontmatter parser reads back unchanged (quotes around values that look like lists, booleans or quotes). */
const scalarText = (value: string): string => {
    const flat = value.replace(/\s+/g, ' ').trim();
    return /^[["']|["']$|^(true|false)$/.test(flat) ? `'${flat}'` : flat;
};

const listText = (key: string, items: readonly string[]): string[] =>
    items.length ? [`${key}:`, ...items.map(i => `  - ${scalarText(i)}`)] : [];

/** The Markdown file for a habit; `parsePlaybook` reads it back to the same fields. */
export const playbookFileText = (draft: PlaybookDraft): string => [
    '---',
    `name: ${scalarText(draft.name)}`,
    `when: ${scalarText(draft.when)}`,
    ...listText('keywords', draft.keywords),
    ...listText('globs', draft.globs),
    ...(draft.errorRegex?.trim() ? [`errorRegex: ${scalarText(draft.errorRegex)}`] : []),
    ...listText('steps', draft.steps),
    ...listText('allowedTools', draft.allowedTools),
    ...listText('doneCriteria', draft.doneCriteria),
    '---',
    ...(draft.notes.trim() ? [draft.notes.trim()] : []),
    ''
].join('\n');

/** `Payments bug!` → `payments-bug.md`; undefined when nothing usable is left. */
export const playbookFileName = (name: string): string | undefined => {
    const slug = slugify(name.replace(/\.(md|mdc)$/i, ''));
    return slug ? `${slug}${PLAYBOOK_FILE_EXT}` : undefined;
};

export const draftOf = (p: Playbook): PlaybookDraft => ({
    name: p.name, when: p.when, globs: p.globs, keywords: p.keywords, ...(p.errorRegex ? { errorRegex: p.errorRegex } : {}),
    steps: p.steps, allowedTools: p.allowedTools, doneCriteria: p.doneCriteria, notes: p.notes
});

/** Starting point for "+ Add" on the Habits page. */
export const blankDraft = (): PlaybookDraft => ({
    name: 'New habit', when: 'Describe the scenario, for example: a bug in the payments flow', globs: [], keywords: [], steps: [PLAYBOOK_TEMPLATE_STEP],
    allowedTools: [], doneCriteria: [], notes: ''
});

/** A habit by name or slug (case-insensitive), for `use_habit`. */
export const findPlaybook = (playbooks: readonly Playbook[], name: string): Playbook | undefined => {
    const wanted = name.trim().toLowerCase();
    return playbooks.find(p => p.name.toLowerCase() === wanted) ?? playbooks.find(p => p.slug === slugify(wanted)) ?? playbooks.find(p => p.id === name.trim());
};

const checks = (items: readonly string[]): HabitCheck[] => items.map(text => ({ text, done: false }));

export const activeHabit = (p: Playbook, pickedBy: HabitPick, reason?: string): ActiveHabit => ({
    id: p.id, name: p.name, path: p.path, steps: checks(p.steps), criteria: checks(p.doneCriteria), allowedTools: [...p.allowedTools], pickedBy,
    ...(reason ? { reason } : {})
});

/** The habit file changed while a chat follows it: new steps, ticks kept for steps with the same text. */
export const refreshHabit = (habit: ActiveHabit, p: Playbook): ActiveHabit => {
    const keep = (prior: readonly HabitCheck[], items: readonly string[]): HabitCheck[] =>
        items.map(text => ({ text, done: prior.some(c => c.text === text && c.done) }));
    return { ...habit, name: p.name, path: p.path, steps: keep(habit.steps, p.steps), criteria: keep(habit.criteria, p.doneCriteria), allowedTools: [...p.allowedTools] };
};

const markRegex = (): RegExp => new RegExp(HABIT_MARK_LINE.source, HABIT_MARK_LINE.flags);

/** `HABIT-STEP: 2` / `HABIT-DONE: 1, 3` lines in a reply. */
export const habitMarks = (text: string): HabitMarks => {
    const steps: number[] = [];
    const done: number[] = [];
    for (const match of text.matchAll(markRegex())) {
        const numbers = match[2].split(/[,\s]+/).map(Number).filter(n => Number.isInteger(n) && n > 0);
        (match[1].toUpperCase() === 'STEP' ? steps : done).push(...numbers);
    }
    return { steps, done };
};

export const stripHabitMarks = (text: string): string => text.replace(markRegex(), '').replace(/\n{3,}/g, '\n\n').trim();

const tick = (items: readonly HabitCheck[], numbers: readonly number[]): HabitCheck[] =>
    items.map((c, i) => numbers.includes(i + 1) ? { ...c, done: true } : c);

export const tickHabit = (habit: ActiveHabit, marks: HabitMarks): ActiveHabit =>
    marks.steps.length || marks.done.length ? { ...habit, steps: tick(habit.steps, marks.steps), criteria: tick(habit.criteria, marks.done) } : habit;

const commandsIn = (text: string): string[] => [...text.matchAll(/`([^`]+)`/g)].map(m => m[1].replace(/\s+/g, ' ').trim()).filter(Boolean);

const ranCommand = (text: string, command: string): boolean => {
    const ran = command.replace(/\s+/g, ' ').trim();
    return commandsIn(text).some(c => ran === c || ran.startsWith(`${c} `));
};

/**
 * A command the agent ran ticks steps that name it in backticks (`npm test`); when it succeeded it also ticks done
 * criteria that name it.
 */
export const tickCommand = (habit: ActiveHabit, command: string, ok: boolean): ActiveHabit => ({
    ...habit,
    steps: habit.steps.map(s => !s.done && ranCommand(s.text, command) ? { ...s, done: true } : s),
    criteria: ok ? habit.criteria.map(c => !c.done && ranCommand(c.text, command) ? { ...c, done: true } : c) : habit.criteria
});

/** Whether a tool may run while the habit is active (`read_file`, `ingot/read_file`, `github/*`, `*`). */
export const habitToolAllowed = (habit: Pick<ActiveHabit, 'allowedTools' | 'off'> | undefined, server: string, tool: string, builtinServer: string): boolean => {
    if (!habit || habit.off || !habit.allowedTools.length || (server === builtinServer && ALWAYS_ALLOWED_TOOLS.includes(tool))) {
        return true;
    }
    return habit.allowedTools.some(a => a === '*' || a === `${server}/${tool}` || a === `${server}/*` || (server === builtinServer && a === tool));
};

export const habitProgress = (habit: Pick<ActiveHabit, 'steps'>): string => `${habit.steps.filter(s => s.done).length}/${habit.steps.length}`;

/** The habit index in the system prompt: name and trigger, picked with the use_habit tool. */
export const formatHabitIndex = (playbooks: readonly Playbook[], tool: string): string => playbooks.length
    ? [`Habits (team playbooks: what to do in which scenario). When the task matches one and none is active, call ${tool} {"name": "<habit name>"} first, then follow its steps.`,
        ...playbooks.map(p => `- ${p.name}: ${p.when}`)].join('\n')
    : '';

const numbered = (items: readonly HabitCheck[]): string[] => items.map((c, i) => `${i + 1}. [${c.done ? 'x' : ' '}] ${c.text}`);

/** The active habit's steps, tool limits and done criteria, plus how to tick them off. */
export const formatActiveHabit = (habit: ActiveHabit, notes = ''): string => [
    `Active habit: ${habit.name} (${habit.path}). Follow these steps in order:`,
    ...numbered(habit.steps),
    ...(habit.allowedTools.length ? [`While this habit is active only these tools may be called: ${habit.allowedTools.join(', ')}.`] : []),
    ...(habit.criteria.length ? ['Done criteria (verify each before you finish):', ...numbered(habit.criteria)] : []),
    ...(notes.trim() ? ['Notes:', notes.trim()] : []),
    'After you finish a step, write "HABIT-STEP: <n>" on its own line. For each done criterion you verified, write "HABIT-DONE: <n>" on its own line.'
].join('\n');

/** Hidden reminder before finishing when done criteria are still open; undefined when there is nothing to check (or it was sent). */
export const doneNudge = (habit: ActiveHabit | undefined): string | undefined => {
    if (!habit || habit.off || (habit.nudged ?? 0) >= MAX_DONE_NUDGES) {
        return undefined;
    }
    const open = habit.criteria.map((c, i) => ({ c, n: i + 1 })).filter(x => !x.c.done);
    return open.length
        ? [`Before you finish, check the done criteria of the habit "${habit.name}":`, ...open.map(x => `${x.n}. ${x.c.text}`),
            'Verify each one (run the check if needed). Write "HABIT-DONE: <n>" for each one that is met; if one cannot be met, say why.'].join('\n')
        : undefined;
};
