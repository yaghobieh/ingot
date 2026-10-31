import type { RejectionPattern } from './learned-rules.types';

export const LEARNED_STATE_VERSION = 1;
export const LEARNED_STATE_FILE = '.ingot/.state/learned-rules.json';
export const LEARNED_RULE_PREFIX = 'learned-';
export const LEARNED_RULES_DIR = '.ingot/rules/';
export const LEARNED_RULE_EXTENSION = '.md';

export const LEARNED_PREFS = {
    enabled: 'ingot.rules.learnFromReviews'
} as const;

/** A correction becomes a proposal once you have said it this many times. */
export const CORRECTION_REPEATS = 2;
/** Word overlap (Jaccard) at which two corrections count as the same one. */
export const CORRECTION_SIMILARITY = 0.5;
export const MAX_CORRECTIONS = 200;
export const MAX_EVIDENCE = 3;
export const MAX_EVIDENCE_CHARS = 160;
export const MAX_TITLE_CHARS = 60;
export const MAX_INSTRUCTION_CHARS = 240;
export const MAX_SLUG_CHARS = 40;
export const MIN_WORD_CHARS = 3;
export const MIN_CORRECTION_WORDS = 2;
/** "don't", "never", "avoid" all become this word, so "Don't use npm" and "Never use npm" match. */
export const NEGATION = 'not_';

/** A message that corrects the agent starts like this (after an optional "no," / "again," / "please")... */
export const CORRECTION_STRONG = /^(?:don'?t|do not|never|stop|always|avoid)\b/i;
/** ...or like this, but only after a cue ("No, use pnpm") or with "instead", so plain requests ("Use React for this") never count. */
export const CORRECTION_SOFT = /^(?:use|keep|put|prefer|only|write|call|name)\b/i;
/** Leading words dropped from the instruction. */
export const CORRECTION_FILLER = /^(?:(?:no|nope|wrong|again|please|i (?:said|told you|asked you)|like i said|as i said)\b[\s,.:!-]*)+/i;
export const CORRECTION_CUES = /^(?:no|nope|wrong|again|i (?:said|told you|asked you)|like i said|as i said)\b/i;
export const INSTEAD = /\binstead\b/i;

export const STOP_WORDS: readonly string[] = [
    'the', 'and', 'for', 'with', 'that', 'this', 'you', 'your', 'are', 'not', 'but', 'please', 'again', 'said', 'told', 'any', 'all',
    'from', 'into', 'its', 'it\'s', 'our', 'can', 'just', 'like', 'then', 'them', 'they', 'there', 'here', 'when', 'what', 'was', 'were'
];

/** Code an agent wrote that you rejected; each match is drafted into a rule. */
export const REJECTION_PATTERNS: readonly RejectionPattern[] = [
    { id: 'console-log', test: /\bconsole\.(?:log|debug)\(/, title: 'No console.log in code', body: 'Don\'t leave `console.log` or `console.debug` calls in code. Use the project\'s logger, or remove them before finishing.' },
    { id: 'default-export', test: /^\s*export\s+default\b/, title: 'Named exports only', body: 'Use named exports. Don\'t add `export default`.' },
    { id: 'any-type', test: /(?::\s*any\b|<any>|\bas any\b)/, title: 'No any', body: 'Don\'t type values as `any`. Use a precise type, or `unknown` and narrow it.' },
    { id: 'ts-ignore', test: /@ts-(?:ignore|nocheck)\b/, title: 'Don\'t silence the type checker', body: 'Don\'t add `@ts-ignore` or `@ts-nocheck`. Fix the type error instead.' },
    { id: 'eslint-disable', test: /eslint-disable/, title: 'Don\'t disable lint rules', body: 'Don\'t add `eslint-disable` comments. Change the code so the lint rule passes.' },
    { id: 'parent-import', test: /(?:from\s+|require\()\s*['"]\.\.\//, title: 'Use path aliases', body: 'Import across folders with the tsconfig path aliases, not `../` relative paths.' },
    { id: 'var', test: /^\s*var\s+\w/, title: 'No var', body: 'Use `const` (or `let` when it is reassigned). Never `var`.' },
    { id: 'todo', test: /\b(?:TODO|FIXME|XXX)\b/, title: 'No TODO comments', body: 'Don\'t leave TODO or FIXME comments. Finish the change, or say in chat what is left.' },
    { id: 'hex-color', test: /#[0-9a-fA-F]{6}\b|#[0-9a-fA-F]{3}\b(?![\w-])/, title: 'No hard-coded colors', body: 'Don\'t hard-code colors. Use the design tokens (CSS variables) instead.' }
];

export const LEARNED_SOURCE_LABELS = {
    rejection: 'From a change you rejected',
    correction: 'You said this more than once'
} as const;
