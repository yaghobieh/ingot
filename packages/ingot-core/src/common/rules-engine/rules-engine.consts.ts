import type { DoctorCode, EffectiveStatus, LayerKind, RuleHitCode, RuleKind, RuleSource, Severity } from './rules-engine.types';

/** ≈4 characters per token, as the agent's usage meter estimates. */
export const CHARS_PER_TOKEN = 4;

export const DOCTOR_DEFAULTS = {
    /** Always-on tokens per turn before the doctor warns. */
    budget: 4_000,
    /** One rule above this is oversized. */
    maxRuleTokens: 1_500
} as const;

export const DOCTOR_CONFIG_FILE = '.ingot/doctor.json';

/** A line shorter than this is not reported as a duplicate (headings, "Be concise."). */
export const MIN_DUPLICATE_LINE_CHARS = 24;
/** Files listed in a glob preview / dead-glob hint. */
export const GLOB_PREVIEW_LIMIT = 20;

/** Config folders that hold `rules/`, and the source each one maps to. Later wins on a name clash. */
export const RULE_FOLDERS = [
    { dir: '.cursor', source: 'external' },
    { dir: '.alloy', source: 'legacy' },
    { dir: '.ingot', source: 'ingot' }
] as const satisfies readonly { dir: string; source: RuleSource }[];

/** Name-clash priority: a higher number wins (global < imported < legacy < `.ingot`). */
export const SOURCE_PRIORITY: Readonly<Record<RuleSource, number>> = {
    global: 0, external: 1, legacy: 2, ingot: 3, agents: 4, habit: 5
};

/** Listing order inside one folder, as the agent reads them: agent files first, then rule folders. */
export const SOURCE_ORDER: Readonly<Record<RuleSource, number>> = {
    agents: 0, global: 1, external: 2, legacy: 3, ingot: 4, habit: 5
};

export const SOURCE_LABELS: Readonly<Record<RuleSource, string>> = {
    ingot: '.ingot rules',
    external: 'Imported (.cursor)',
    legacy: 'Legacy (.alloy)',
    agents: 'Agent instructions',
    global: 'Global (~/.ingot)',
    habit: 'Habit'
};

export const KIND_LABELS: Readonly<Record<RuleKind, string>> = {
    always: 'always',
    auto: 'globs',
    agent: 'agent requested',
    manual: 'manual (@)'
};

export const AGENT_FILE_NAMES = ['AGENTS.md', 'CLAUDE.md'] as const;
export const ROOT_ONLY_AGENT_FILES = ['.cursorrules'] as const;
export const RULE_FILE_EXTENSIONS = ['.md', '.mdc'] as const;
export const GLOBAL_PREFIX = '~/';
export const GLOBAL_RULES_DIR = '~/.ingot/rules/';
export const HABITS_FOLDER = '.ingot/habits/';

/** `.ingot/rules/x.md`, `packages/web/.cursor/rules/y.mdc`: scope, config folder and rest. */
export const RULE_PATH_PATTERN = /^(?:(.+?)\/)?\.(ingot|cursor|alloy)\/rules\/(.+\.mdc?)$/i;
export const AGENT_PATH_PATTERN = /^(?:(.+)\/)?(AGENTS\.md|CLAUDE\.md)$/;
export const HABIT_PATH_PATTERN = /^(?:(.+?)\/)?\.ingot\/habits\/[^/]+\.mdc?$/i;

/** Folders whose files mark a package root in a monorepo. */
export const PACKAGE_MANIFESTS = ['package.json', 'pyproject.toml', 'go.mod', 'Cargo.toml', 'pom.xml', 'build.gradle', 'build.gradle.kts', 'composer.json', 'Gemfile', 'deno.json'] as const;

export const SEVERITY_ORDER: Readonly<Record<Severity, number>> = { error: 0, warning: 1, info: 2 };

export const DOCTOR_CODE_LABELS: Readonly<Record<DoctorCode, string>> = {
    conflict: 'Conflict',
    override: 'Override',
    'dead-glob': 'Dead glob',
    duplicate: 'Duplicate',
    'duplicate-line': 'Duplicate line',
    shadowed: 'Shadowed',
    oversized: 'Oversized',
    budget: 'Over budget',
    empty: 'Empty',
    'manual-only': 'Manual only',
    schema: 'Schema'
};

export const DOCTOR_CODES = Object.keys(DOCTOR_CODE_LABELS) as readonly DoctorCode[];

export const RULE_HIT_LABELS: Readonly<Record<RuleHitCode, string>> = {
    always: 'always',
    'agents-file': 'AGENTS.md',
    'nested-agents': 'nearest AGENTS.md',
    glob: 'glob',
    mention: '@-mention',
    'agent-requested': 'agent requested',
    habit: 'habit',
    loaded: 'loaded'
};

export const LAYER_LABELS: Readonly<Record<LayerKind, string>> = {
    global: 'Global',
    root: 'Root',
    package: 'Package',
    folder: 'Folder'
};

export const STATUS_LABELS: Readonly<Record<EffectiveStatus, string>> = {
    applied: 'applied',
    available: 'on request',
    manual: '@-mention only',
    'not-matching': 'no glob match',
    overridden: 'overridden',
    shadowed: 'shadowed'
};

/** Sentence openers that forbid something. */
export const NEGATIVE_DIRECTIVE = /^(?:never|don'?t|do not|avoid|must not|mustn'?t|should not|shouldn'?t|stop|no longer|no)\s+(.+)$/i;
/** Sentence openers that ask for something. */
export const POSITIVE_DIRECTIVE = /^(?:always|only|prefer|must|should|use|stick to)\s+(.+)$/i;
/** Words dropped in front of a directive ("Please always…", "We never…"). */
export const DIRECTIVE_FILLER = /^(?:please|you|we|also|and|then)\s+/i;
/** Verbs dropped in front of the object ("never use tabs" → "tabs"). */
export const DIRECTIVE_VERBS = /^(?:use|using|add|adding|write|writing|put|include|including|leave|leaving|have|prefer|be)\s+/i;
/** The object ends at the first clause ("tabs for indentation" → "tabs"). */
export const DIRECTIVE_CLAUSE = /\s+(?:for|in|when|because|unless|if|instead|so|to|over|on|with|except)\b.*$|[,;:(].*$/i;
export const DIRECTIVE_ARTICLES = /\b(?:the|a|an|any)\s+/gi;
export const MIN_DIRECTIVE_CHARS = 3;
export const MAX_DIRECTIVE_WORDS = 6;

/** Choices where asking for one contradicts asking for another (tabs vs spaces). */
export const EXCLUSIVE_CHOICES: readonly (readonly { readonly label: string; readonly test: RegExp }[])[] = [
    [{ label: 'tabs', test: /\btabs?\b/ }, { label: 'spaces', test: /\b(?:\d+[- ])?spaces?\b/ }],
    [{ label: 'single quotes', test: /\bsingle[- ]quotes?\b/ }, { label: 'double quotes', test: /\bdouble[- ]quotes?\b/ }],
    [{ label: 'named exports', test: /\bnamed exports?\b/ }, { label: 'default exports', test: /\bdefault exports?\b/ }],
    [{ label: 'npm', test: /^npm\b/ }, { label: 'yarn', test: /^yarn\b/ }, { label: 'pnpm', test: /^pnpm\b/ }, { label: 'bun', test: /^bun\b/ }],
    [{ label: 'jest', test: /^jest\b/ }, { label: 'vitest', test: /^vitest\b/ }, { label: 'mocha', test: /^mocha\b/ }],
    [{ label: 'arrow functions', test: /\barrow functions?\b/ }, { label: 'function declarations', test: /\bfunction declarations?\b/ }],
    [{ label: 'interfaces', test: /^interfaces?\b/ }, { label: 'type aliases', test: /^type aliases?\b|^types\b/ }],
    [{ label: 'camelCase', test: /\bcamel ?case\b/ }, { label: 'snake_case', test: /\bsnake[_ ]?case\b/ }, { label: 'kebab-case', test: /\bkebab[- ]?case\b/ }],
    [{ label: 'class components', test: /\bclass components?\b/ }, { label: 'function components', test: /\b(?:function|functional) components?\b/ }]
];

/** Habit match weights (as the habit matcher): an error is strongest, a file match alone needs a second signal. */
export const HABIT_WEIGHTS = { error: 3, keyword: 2, glob: 1, globOnly: 2 } as const;
export const MIN_HABIT_SCORE = 2;

/** Store packs: `.ingot/ingot-lock.json` and packages installed by `ingot try` (`.ingot/extensions/<publisher>.<name>/ingot.json`). */
export const LOCK_FILE = '.ingot/ingot-lock.json';
export const EXTENSIONS_DIR = '.ingot/extensions/';
export const EXTENSION_MANIFEST = 'ingot.json';
/** `ingot try` copies a pack's rule as `.ingot/rules/<pack name>--<file>`. */
export const PACK_RULE_SEPARATOR = '--';
export const PACK_FRONTMATTER_KEY = 'pack';
