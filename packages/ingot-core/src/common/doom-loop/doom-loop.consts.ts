/** IDEA-304: failed approaches stay in the project so the agent does not walk into them again. */
export const ANTI_HABITS_FILE = '.ingot/anti-habits.md';
export const ANTI_HABITS_TITLE = '# Anti-habits';
export const ANTI_HABITS_INTRO = "Approaches that already failed here (Doom-Loop Breaker). The agent is told not to repeat them; delete a line to forget it.";
/** `- Don't: Edit src/math.js and rerun node test.js <!-- id=…; signature=…; files=a,b; count=1; at=2026-10-31 -->` */
export const ANTI_HABIT_LINE = /^\s*[-*]\s*(?:Don'?t:\s*)?(.+?)\s*(?:<!--(.*?)-->)?\s*$/i;
export const ANTI_HABIT_PREFIX = "Don't: ";

export const DOOM_PREFS = { enabled: 'ingot.agent.doomLoop.enabled', maxRepeats: 'ingot.agent.doomLoop.maxRepeats' } as const;
/** The same error signature this many times pauses the run. */
export const DEFAULT_MAX_REPEATS = 3;
export const MIN_MAX_REPEATS = 2;
/** "Fixed" claims the next result disproves before the run pauses. */
export const MAX_FALSE_CLAIMS = 2;
export const MAX_TRIED_LINES = 6;
export const MAX_SIGNATURE_CHARS = 120;
export const MAX_ACTION_CHARS = 80;
export const MAX_ANTI_HABITS = 100;
export const MAX_PROMPT_ANTI_HABITS = 10;

/** The line of a failure that says what went wrong. */
export const ERROR_LINE = /\b(?:error|exception|fail(?:ed|ure|s)?|assert(?:ion)?|cannot|can't|not found|undefined is not|is not a function|expected|panic|traceback|denied|refused|segmentation)\b/i;
// eslint-disable-next-line no-control-regex
export const ANSI = /\u001b\[[0-9;]*[A-Za-z]/g;
/** A reply that says the problem is solved ("Fixed it, the tests pass now."). */
export const SUCCESS_CLAIM = /\b(?:(?:i(?:'ve| have)? |this |that |it'?s |now )?(?:fixed|resolved|solved)\b|should (?:now )?(?:work|pass)|(?:tests?|build|checks?) (?:should )?(?:now )?(?:pass(?:es)?|succeeds?|(?:is|are) green)|all (?:tests )?(?:pass|green)|works now|passing now)/i;

export const DOOM_KIND_LABELS = { repeat: 'Same error again', cycle: 'Fix → break cycle', claims: 'Contradictory claims' } as const;
export const DOOM_NOTE = 'Saved to Habits';
export const DOOM_ACTIONS = { reset: 'Reset', different: 'Try a different approach', keep: 'Keep going', stop: 'Stop here' } as const;
/** System lines in the chat when the run pauses and when the user picks a card action. */
export const DOOM_MESSAGES = {
    paused: 'Paused: ',
    different: 'Trying a different approach.',
    keep: 'Going on.',
    reset: (prompt: string): string => `Reset: files are back to before "${prompt}".`,
    resetFailed: 'Could not reset files: '
} as const;
