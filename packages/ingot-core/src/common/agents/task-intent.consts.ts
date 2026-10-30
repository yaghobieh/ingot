/** IDEA-267: the agent's default way of working, and the nudge when it summarizes the repo instead of doing the task. */
export const AGENT_WORKFLOW = [
    'How you work on every request:',
    '1. Understand: work out what is asked. Use the IDE context you are given, then read the code it touches (ingot/grep, ingot/glob, ingot/read_file) before you answer or edit.',
    '2. Plan: for anything bigger than a one-line change, start with a short PLAN: list (3-6 steps).',
    '3. Act: make the change yourself with EDIT blocks and tools. Do not hand the user code to paste or commands to run.',
    '4. Verify: build or run the tests (ingot/run or ingot/run_script) and fix what fails before you stop.',
    '5. Summarize: end with two to four short lines: what changed, how you verified it, anything left to do.',
    'An action request (fix, add, rename, create, scaffold, refactor…) is answered by doing it, never with a generic summary of the repository.',
    'A question about specific code is answered about that code, after reading it.'
].join('\n');

export const ACT_NUDGE = [
    'You described the repository instead of doing what was asked. Do not summarize the project.',
    'Do the task now: read the files you need with the project tools, make the change with EDIT blocks, run the build or tests, then give a short summary of what you changed.'
].join(' ');

export const EXPLAIN_NUDGE = [
    'You gave a general overview instead of answering about the code that was asked about.',
    'Read that file or module with ingot/read_file (find it with ingot/glob or ingot/grep first if needed) and explain it specifically: purpose, main functions, data flow, edge cases.'
].join(' ');

/** Verbs that start a request to change something. */
export const ACTION_VERB = /^(?:fix|add|create|implement|build|write|rename|refactor|move|remove|delete|update|change|make|scaffold|generate|set ?up|install|migrate|upgrade|convert|replace|extract|split|bump|wire|hook up|port|optimi[sz]e|improve|clean ?up|introduce|enable|disable|commit|rewrite|translate|format|lint|test|run|debug|patch|resolve)\b/i;
/** Polite or filler openings before the verb. */
export const REQUEST_LEAD = /^(?:(?:ok(?:ay)?|so|now|then|also|and|please|pls|hey|hi)[,!.]?\s+)*(?:(?:can|could|would|will) you\s+(?:please\s+)?|i (?:want|need) you to\s+|i(?:'d| would) like you to\s+|let'?s\s+|go ahead and\s+|help me\s+|try to\s+)?(?:please\s+)?/i;
export const EXPLAIN_REQUEST = /^(?:explain|describe|walk me through|what does|how does|tell me (?:about|what)|document)\b/i;
/** A named target in a question: a file path, a module path or a `symbol`. */
export const NAMED_TARGET = /(?:[\w-]+\/)+[\w.-]+|\b[\w-]+\.(?:[jt]sx?|mjs|cjs|py|go|rs|java|kt|rb|php|cs|css|scss|html|json|ya?ml|md|sh)\b|`[^`]+`/;

/** Phrases of a repository overview. */
export const SUMMARY_PATTERNS: readonly RegExp[] = [
    /\b(?:this|the) (?:project|repository|repo|codebase|workspace|application|app) (?:is|contains|appears|seems|provides|consists|includes|has|uses)\b/i,
    /\b(?:project|directory|folder|repository|repo) (?:structure|layout|overview)\b/i,
    /\b(?:key|main) (?:features|files|components|directories|folders|modules)\b/i,
    /\btech(?:nology)? stack\b/i,
    /^#+\s*(?:overview|summary|project overview|about (?:this|the) (?:project|repo))\b/im
];
/** A bullet that lists a top-level folder or file, as overviews do. */
export const LISTING_LINE = /^\s*(?:[-*]|\d+[.)])\s+\**`?[\w.-]+\/?`?\**\s*(?:[:—–-]|\()/;
export const LISTING_MIN_LINES = 3;
export const SUMMARY_MIN_SCORE = 2;
