/** IDEA-296: learned habits stay on this machine, in the project's `.ingot/habits.json` (git-ignored). */
export const HABITS_FILE = '.ingot/habits.json';
export const HABITS_GITIGNORE = '.ingot/.gitignore';
export const HABITS_GITIGNORE_ENTRY = 'habits.json';
export const HABITS_FILE_VERSION = 1;

export const HABITS_PREFS = { enabled: 'ingot.habits.enabled', threshold: 'ingot.habits.threshold' } as const;
export const DEFAULT_HABIT_THRESHOLD = 3;
export const MIN_HABIT_THRESHOLD = 2;
export const MAX_HABIT_EXAMPLES = 5;
export const MAX_HABITS = 200;
export const MAX_EXAMPLE_CHARS = 160;

/** A sentence that tells the agent how to work ("use Bear components", "never add comments"). */
export const INSTRUCTION_START = /^(always|never|don'?t|do not|use|prefer|avoid|make sure|stop|keep|no more|only use)\b/i;
export const INSTRUCTION_MIN_CHARS = 6;
export const INSTRUCTION_MAX_CHARS = 100;
export const INSTRUCTION_MAX_WORDS = 14;
/** Words dropped in front of an instruction before comparing. */
export const INSTRUCTION_FILLER = /^(please|and|also|then|again|but|so|ok|okay)[,\s]+/i;

export const COMMAND_MIN_CHARS = 3;
export const COMMAND_MAX_CHARS = 120;
/** Commands too common to be a habit worth a rule. */
export const TRIVIAL_COMMANDS: readonly RegExp[] = [/^(ls|ll|cd|pwd|clear|exit|echo|cat|which|whoami|history)\b/, /^git (status|log|diff|branch)\b/];

/** Styles that, rejected again and again, are worth a rule. */
export const REJECTION_PATTERNS: readonly { readonly id: string; readonly test: RegExp; readonly label: string; readonly rule: string }[] = [
    { id: 'console-log', test: /\bconsole\.(log|debug)\(/, label: 'add console.log calls', rule: 'Do not add console.log or console.debug calls.' },
    { id: 'any-type', test: /:\s*any\b|\bas any\b|<any>/, label: 'use the any type', rule: 'Do not use the TypeScript any type; use precise types.' },
    { id: 'default-export', test: /^\s*export default\b/, label: 'use default exports', rule: 'Use named exports, not default exports.' },
    { id: 'var', test: /^\s*var\s+\w/, label: 'declare variables with var', rule: 'Use const or let, never var.' },
    { id: 'inline-style', test: /style=\{\{/, label: 'add inline styles', rule: 'Do not use inline styles; use CSS classes and design tokens.' },
    { id: 'todo', test: /\/\/\s*(TODO|FIXME)\b/, label: 'leave TODO comments', rule: 'Do not leave TODO or FIXME comments; finish the work instead.' },
    { id: 'function-declaration', test: /^\s*(export\s+)?function\s+\w+\s*\(/, label: 'write function declarations', rule: 'Prefer arrow functions (const name = () => …) over function declarations.' }
];

export const HABIT_TARGET_LABELS = { rule: 'Make it a rule', command: 'Make it a command', hook: 'Make it a hook' } as const;

export const HABIT_KIND_LABELS = { instruction: 'Instruction', command: 'Command', rejection: 'Rejected edit' } as const;
export const HABIT_STATUS_LABELS = { learning: 'learning', proposed: 'suggested', accepted: 'saved', dismissed: 'dismissed' } as const;
/** Settings page and Find Action command for the Habits panel. */
export const HABITS_SETTINGS_PAGE = 'habits';
export const HABITS_OPEN_COMMAND = { id: 'ingot.habits.open', label: 'Show Habits', category: 'Ingot' } as const;

/** Habits page focus id of a learned pattern (playbooks use their own id, `project:<slug>`). */
export const LEARNED_FOCUS_PREFIX = 'learned:';
export const HABIT_NOTE_LABELS = { saved: 'Saved to Habits', undone: 'Removed from Habits', undo: 'Undo', open: 'Open in Habits' } as const;
export const HABIT_NOTE_LEARNED_PREFIX = 'Learned:';
