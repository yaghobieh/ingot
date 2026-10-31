export const PLANS_DIR = '.ingot/plans';
export const PLAN_TEMPLATES_DIR = '.ingot/plans/templates';
export const MAX_PLAN_SLUG_CHARS = 40;
/** Words shorter than this never match a path. */
export const MIN_KEYWORD_CHARS = 4;
/** A path-like token: has a slash or a file extension. */
export const PATH_TOKEN = /(?:[\w.-]+\/)+[\w.-]+|[\w-]+\.[a-z][a-z0-9]{0,5}\b/gi;
export const URL_TOKEN = /\b[a-z][a-z0-9+.-]*:\/\/\S+/gi;
/** Steps that are about running something (tests, build, checks) match a command the run executed. */
export const RUN_STEP = /\b(run|rerun|verify|check|test|tests|build|lint|typecheck|gate|e2e)\b/i;
export const STOPWORDS: ReadonlySet<string> = new Set([
    'the', 'and', 'with', 'from', 'into', 'that', 'this', 'then', 'them', 'they', 'when', 'where', 'which', 'while', 'make', 'sure', 'each',
    'update', 'change', 'changes', 'add', 'adds', 'new', 'file', 'files', 'code', 'step', 'steps', 'using', 'use', 'should', 'would', 'also',
    'write', 'create', 'implement', 'logic', 'small', 'function', 'method', 'class', 'test', 'tests', 'run', 'check', 'verify', 'build', 'fix'
]);
export const TEMPLATE_FILE_PLACEHOLDER = '<file>';
export const TEMPLATE_NAME_PLACEHOLDER = '<name>';
