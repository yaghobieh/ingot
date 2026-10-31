/** IDEA-302: the ledger is plain markdown so it can be read, edited and committed like any other project file. */
export const DECISIONS_FILE = '.ingot/decisions.md';
export const DECISIONS_TITLE = '# Decisions';
export const DECISIONS_INTRO = 'Agreed with the agent. Locked decisions ([x]) are checked before every edit, plan and command; the agent asks before contradicting one.';
/** `- [x] Use Postgres, not SQLite <!-- id=…; confirmed=2; avoid=sqlite; at=2026-10-31 -->` */
export const DECISION_LINE = /^\s*[-*]\s*\[( |x|X)\]\s*(.+?)\s*(?:<!--(.*?)-->)?\s*$/;
export const DECISION_META_SEPARATOR = ';';
export const DECISION_LIST_SEPARATOR = ',';
export const DECISION_RULES_DIR = '.ingot/rules';
export const DECISION_RULE_PREFIX = 'decision-';

/** Confirmations this many times make a decision a habit (an always-applied rule). */
export const DECISION_HABIT_THRESHOLD = 3;
export const MAX_DECISIONS = 200;
export const MAX_DECISION_CHARS = 200;
export const MAX_TERM_WORDS = 3;
export const MIN_TERM_CHARS = 2;

/** A line the agent writes to propose a decision: `DECISION: Use Postgres for the order store, not SQLite`. */
export const DECISION_MARK = /^\s*(?:[-*]\s*)?\**DECISION\**\s*:\s*(.+?)\s*$/gm;
/** A user message that states a decision outright: `Decision: use pnpm, not npm`. */
export const DIRECT_DECISION = /^\s*(?:decision|decided|we decided|lock(?: in)?)\s*[:-]\s*(.+?)\s*$/gim;
/** A user reply that agrees with what the agent proposed. */
export const CONFIRMATION = /^\s*(?:yes|yep|yeah|yup|ok|okay|sure|agreed?|sounds good|looks good|lgtm|deal|confirm(?:ed)?|do it|go ahead|go for it|let'?s do (?:it|that|this)|let'?s go with (?:it|that|this)|perfect|great|correct|exactly)\b/i;
/** A reply that turns the proposal down, even when it starts with "ok". */
export const REJECTION = /^\s*(?:no|nope|nah|don'?t|do not|not that|wait|hold on|ok,? but no)\b/i;

/** "Use X, not Y", "X instead of Y", "never use Y", "no Y": Y is what a locked decision forbids. */
export const AVOID_PATTERNS: readonly RegExp[] = [
    /\b(?:not|instead of|rather than|in place of|over)\s+((?:[^,;:()!?.]|\.(?=\S))+)/gi,
    /\b(?:never use|don'?t use|do not use|stop using|never|avoid|no more|no)\s+((?:[^,;:()!?.]|\.(?=\S))+)/gi
];
/** Where an avoided term ends ("SQLite for the cache" → "SQLite"). */
export const TERM_END = /\s+(?:for|in|when|because|unless|so|since|if|on|at|to|with)\s+.*$/i;
export const TERM_SPLIT = /\s+(?:or|and|nor)\s+|\s*[,/]\s*/i;
export const TERM_LEADING = /^(?:use|using|add|adding|the|a|an|any|more|longer)\s+/i;

export const DECISION_NOTES = { locked: 'Locked in Decisions', unlocked: 'Unlocked', habit: 'Saved to Habits' } as const;
export const DECISION_ASK_OPTIONS = { keep: 'Keep the decision', once: 'Go ahead this time', unlock: 'Unlock the decision' } as const;

export const DECISIONS_PROTOCOL = 'Decisions: when you propose a choice the user should agree to (a library, data store, API shape, naming or approach), put each one on its own line as `DECISION: <one short sentence, e.g. Use Postgres for the order store, not SQLite>`. When the user agrees, Ingot locks it in .ingot/decisions.md.';

export const DECISIONS_SETTINGS_PAGE = 'decisions';
export const DECISION_COMMANDS = {
    open: { id: 'ingot.decisions.open', label: 'Show Decisions', category: 'Ingot' },
    lock: { id: 'ingot.decisions.lock', label: 'Lock a Decision…', category: 'Ingot' }
} as const;
