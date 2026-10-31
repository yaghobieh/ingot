import type { PlaybookScope, PlaybookSource } from './playbook.types';

/** IDEA-296 Habits v2: habit (playbook) folders. `.ingot/habits` in the project, `habits` in the user config folder, `.cursor/habits` read too. */
export const HABITS_DIR = 'habits';
export const PLAYBOOK_FILE_EXT = '.md';
export const PLAYBOOK_EXTENSIONS = ['.md', '.mdc'] as const;

/** Frontmatter keys a habit file may use. */
export const PLAYBOOK_KEYS = ['name', 'when', 'globs', 'keywords', 'errorRegex', 'steps', 'allowedTools', 'doneCriteria'] as const;
export const PLAYBOOK_LIST_KEYS = ['globs', 'keywords', 'steps', 'allowedTools', 'doneCriteria'] as const;
export const MAX_PLAYBOOK_STEPS = 20;
export const MAX_PLAYBOOK_NAME_CHARS = 64;
/** `read_file`, `ingot/run`, `github/*`, `*`. */
export const TOOL_NAME_PATTERN = /^(\*|[\w.-]+(\/(\*|[\w.-]+))?)$/;

/** Later wins on a name clash: global < `.cursor/habits` < `.ingot/habits`. */
export const PLAYBOOK_SOURCE_ORDER: readonly PlaybookSource[] = ['global', 'cursor', 'project'];
export const PLAYBOOK_SOURCE_LABELS: Readonly<Record<PlaybookSource, string>> = { project: 'Project', global: 'Global', cursor: '.cursor' };
export const PLAYBOOK_SCOPE_HINTS: Readonly<Record<PlaybookScope, string>> = {
    project: 'Saved in .ingot/habits of this project; commit them to share with your team.',
    global: 'Saved in ~/.ingot/habits. They apply in every project.'
};

/** Per-user on/off for habit files (ids), so turning a team habit off does not change the committed file. */
export const PLAYBOOK_PREFS = { disabled: 'ingot.habits.playbooks.disabled', autoSelect: 'ingot.habits.playbooks.autoSelect' } as const;

/** The agent tool that switches to a habit by name. */
export const USE_HABIT_TOOL = 'use_habit';
/** Tools that stay available while a habit restricts tools (switch habit, ask the user). */
export const ALWAYS_ALLOWED_TOOLS: readonly string[] = [USE_HABIT_TOOL, 'ask_user'];

/** Deterministic match weights: an error match is strongest, a file match alone does not pick a habit. */
export const MATCH_WEIGHTS = { error: 3, keyword: 2, glob: 1, globOnly: 2 } as const;
export const MIN_MATCH_SCORE = 2;
export const MAX_SIGNAL_FILES = 200;
export const MAX_TERMINAL_ERROR_LINES = 20;
export const MAX_DIAGNOSTICS = 50;
/** Terminal lines that look like an error worth matching an errorRegex against. */
export const TERMINAL_ERROR_LINE = /\b(error|exception|failed|failure|fatal|traceback|panic|cannot|undefined is not)\b/i;

/** Ticks the agent writes in replies; removed from the visible text. */
export const HABIT_MARK_LINE = /^[ \t]*HABIT-(STEP|DONE):[ \t]*([\d,\s]+?)[ \t]*$/gim;
/** Done-criteria reminders per turn before the agent may finish anyway. */
export const MAX_DONE_NUDGES = 1;
/** Shown for a reply that only ticked habit steps or criteria. */
export const HABIT_TICKED_REPLY = 'Checked off the habit.';

/** "Save this run as a habit" drafts. */
export const MAX_DRAFT_STEPS = 10;
export const MAX_DRAFT_KEYWORDS = 5;
export const MAX_DRAFT_GLOBS = 3;
export const MIN_KEYWORD_CHARS = 4;
export const MAX_NAME_WORDS = 6;
export const MAX_WHEN_CHARS = 140;
/** Consecutive reads folded into one step. */
export const MAX_READS_PER_STEP = 3;
export const CHECK_COMMAND = /\b(test|tests|lint|build|check|typecheck|tsc|vitest|jest|pytest|mocha|playwright|cargo test|go test|gate)\b/i;
export const ERROR_TOKEN = /\b([A-Z][A-Za-z0-9]*(?:Error|Exception)|E[A-Z]{3,}[A-Z0-9]*)\b/g;
/** Tools that are not steps of a habit. */
export const DRAFT_SKIPPED_TOOLS: readonly string[] = [USE_HABIT_TOOL, 'ask_user', 'hook', 'summary', 'processes', 'process_output', 'scripts'];
export const DRAFT_DEFAULT_CRITERION = 'The original problem is fixed and the change is reviewed';
export const DRAFT_FALLBACK_STEPS: readonly string[] = ['Reproduce the problem', 'Make the fix', 'Verify the fix'];
export const STOPWORDS = new Set([
    'this', 'that', 'with', 'from', 'have', 'there', 'their', 'what', 'when', 'where', 'which', 'while', 'would', 'could', 'should', 'please', 'into',
    'about', 'after', 'before', 'again', 'also', 'just', 'like', 'make', 'some', 'them', 'then', 'they', 'these', 'those', 'your', 'yours', 'does',
    'doesnt', 'dont', 'cant', 'isnt', 'wont', 'need', 'want', 'look', 'find', 'check', 'help', 'thanks', 'here', 'only', 'very', 'more', 'most',
    'every', 'each', 'other', 'than', 'being', 'were', 'will', 'shall', 'take', 'used', 'using', 'work', 'works', 'working', 'thing', 'things'
]);

/** Settings page and chat texts. */
export const SAVE_RUN_LABEL = 'Save as habit';
export const MAKE_HABIT_LABEL = 'Make it a habit';
export const HABIT_PILL_PREFIX = 'Using habit:';
export const HABIT_OFF_LABEL = 'Habit off';
export const PLAYBOOK_TEMPLATE_STEP = 'First step';
