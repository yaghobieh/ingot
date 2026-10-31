import type { Command } from '@theia/core/lib/common/command';

export const RULES_INSIGHT_SERVICE_PATH = '/services/ingot/rules-insight';

/** File list cache per project root; the doctor re-runs on every rule save. */
export const FILE_LIST_TTL_MS = 5_000;
export const MAX_PROJECT_FILES = 50_000;
export const GIT_TIMEOUT_MS = 10_000;
export const GIT_MAX_BUFFER = 64 * 1024 * 1024;
/** Folders the walk skips when the project is not a git repository. */
export const WALK_SKIP = ['node_modules', '.git', 'dist', 'out', 'build', 'coverage', '.next', 'lib', 'target', 'vendor', '.venv', '__pycache__'] as const;
/** Config folders always listed, even when gitignored. */
export const CONFIG_FOLDERS = ['.ingot', '.cursor', '.alloy'] as const;
export const GLOBAL_RULE_FILES = ['AGENTS.md'] as const;

/** Problems view owner of the Rules Doctor markers. */
export const DOCTOR_MARKER_OWNER = 'ingot-rules-doctor';
/** Problems view owner of `.ingot` schema markers (live, from the open editor). */
export const SCHEMA_MARKER_OWNER = 'ingot-schema';
export const DOCTOR_DEBOUNCE_MS = 400;

export const SCHEMA_DEBOUNCE_MS = 250;
/** Problems view `source` column. */
export const DOCTOR_SOURCE = 'Rules Doctor';
export const SCHEMA_SOURCE = 'Ingot schema';

/** LSP DiagnosticSeverity values the Problems view uses. */
export const DIAGNOSTIC_SEVERITY = { error: 1, warning: 2, info: 3 } as const;

export const RULE_HITS_WIDGET_ID = 'ingot-rule-hits';
export const EFFECTIVE_RULES_WIDGET_ID = 'ingot-effective-rules';
export const RULE_HITS_LABEL = 'Rule Hits';
export const EFFECTIVE_RULES_LABEL = 'Effective Rules';
/** Turns kept per chat in the Rule Hits panel. */
export const MAX_RULE_HIT_TURNS = 50;
export const PROMPT_PREVIEW_CHARS = 80;
/** Glob completions drawn from the project's extensions and top folders. */
export const GLOB_SUGGESTION_LIMIT = 12;
/** File names the Effective Rules path box suggests. */
export const FILE_SUGGESTION_LIMIT = 200;

export const RULES_INSIGHT_COMMANDS = {
    doctor: { id: 'ingot.rules.doctor', label: 'Run Rules Doctor', category: 'Ingot' },
    ruleHits: { id: 'ingot.rules.hits', label: 'Rule Hits', category: 'View' },
    ruleHitsForLastTurn: { id: 'ingot.rules.hits.last', label: 'Why These Rules? (Last Agent Turn)', category: 'Ingot' },
    effective: { id: 'ingot.rules.effective', label: 'Show Effective Rules for File', category: 'Ingot' },
    effectiveView: { id: 'ingot.rules.effectiveView', label: 'Effective Rules', category: 'View' },
    globPreview: { id: 'ingot.rules.globPreview', label: 'Preview Glob Matches', category: 'Ingot' }
} as const satisfies Record<string, Command>;
