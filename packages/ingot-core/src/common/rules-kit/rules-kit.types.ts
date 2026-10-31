/** A project as the rules kit sees it: every file path (relative, `/`-separated) and a reader. No I/O of its own. */
export interface KitProject {
    readonly files: readonly string[];
    read(path: string): string | undefined;
}

export type KitScalar = string | number | boolean | null;
export type KitValue = KitScalar | KitValue[] | { [key: string]: KitValue };
export type KitMap = { [key: string]: KitValue };

export interface KitRule {
    /** Unique, file-name-safe name: the path under `.ingot/rules` without extension, `/` replaced by `-`. */
    readonly name: string;
    /** Project-relative path of the rule file. */
    readonly path: string;
    readonly description?: string;
    readonly globs: readonly string[];
    readonly alwaysApply: boolean;
    readonly body: string;
    readonly data: Readonly<Record<string, string | boolean | string[]>>;
}

/* ---------- IDEA-319 export ---------- */

export type ExportTarget = 'agents' | 'claude' | 'cursor' | 'windsurf' | 'copilot';
export type ExportAction = 'create' | 'update' | 'delete' | 'unchanged' | 'skipped';

export interface ExportFile {
    readonly path: string;
    readonly target: ExportTarget;
    readonly action: ExportAction;
    /** New file content (create / update / unchanged). */
    readonly content?: string;
    readonly before?: string;
    readonly reason?: string;
    readonly added: number;
    readonly removed: number;
}

export interface ExportPlan {
    readonly targets: readonly ExportTarget[];
    readonly rules: number;
    readonly files: readonly ExportFile[];
    /** True when at least one file would be created, changed or deleted. */
    readonly drift: boolean;
}

export interface ExportOptions {
    readonly targets?: readonly ExportTarget[];
    /** Overwrite hand-written files that sit where a generated file goes. */
    readonly force?: boolean;
}

/* ---------- IDEA-320 rule tests ---------- */

export type AssertionKind = 'contains' | 'not_contains' | 'matches' | 'not_matches' | 'max_words' | 'judge';

export interface RuleAssertion {
    readonly kind: AssertionKind;
    readonly value: string;
}

export interface RuleTestCase {
    /** `<file>#<index>`, stable across runs. */
    readonly id: string;
    readonly name: string;
    readonly file: string;
    readonly prompt: string;
    /** Only these rules (by name) go in the context; otherwise always-on rules plus rules whose globs match `files`. */
    readonly rules?: readonly string[];
    readonly files: readonly string[];
    readonly runs: number;
    readonly asserts: readonly RuleAssertion[];
    /** Reply the mock model gives (CI). */
    readonly mock?: string;
}

export interface RuleTestSuite {
    readonly cases: readonly RuleTestCase[];
    /** `<file>: <problem>` for every test file that could not be used. */
    readonly errors: readonly string[];
}

export type ModelCallKind = 'answer' | 'judge';

export interface ModelRequest {
    readonly kind: ModelCallKind;
    readonly system: string;
    readonly user: string;
    readonly maxTokens: number;
    readonly mock?: string;
}

export interface ModelReply {
    readonly text: string;
    readonly inputTokens: number;
    readonly outputTokens: number;
    /** USD as billed by the provider, when it reports it. */
    readonly cost?: number;
}

export type ModelCaller = (request: ModelRequest) => Promise<ModelReply>;

/** USD per million tokens. */
export interface ModelPrice {
    readonly input: number;
    readonly output: number;
}

export interface RuleTestOptions {
    readonly model: string;
    readonly price: ModelPrice;
    /** Hard cap for the whole run in USD: a call that could cross it is not made. */
    readonly maxCostUsd: number;
    readonly maxTokens: number;
    readonly call: ModelCaller;
    readonly onProgress?: (done: number, total: number) => void;
}

export interface RuleTestRun {
    readonly passed: boolean;
    readonly reply: string;
    readonly failures: readonly string[];
    readonly costUsd: number;
}

export interface RuleTestResult {
    readonly id: string;
    readonly name: string;
    readonly file: string;
    readonly rules: readonly string[];
    readonly runs: readonly RuleTestRun[];
    readonly passed: number;
    /** Runs that were not made because of the cost cap. */
    readonly skipped: number;
    readonly passRate: number;
}

export interface RuleTestReport {
    readonly model: string;
    readonly results: readonly RuleTestResult[];
    readonly passed: number;
    readonly total: number;
    readonly skipped: number;
    readonly passRate: number;
    readonly costUsd: number;
    readonly maxCostUsd: number;
    readonly capped: boolean;
    readonly errors: readonly string[];
}

/* ---------- IDEA-323 prune ---------- */

/** `.ingot/.state/rule-hits.json`, written by the IDE every time a rule is put in an agent's context. */
export interface RuleHitLog {
    readonly version: number;
    /** When hit tracking started (ISO date). */
    readonly since: string;
    readonly rules: Readonly<Record<string, RuleHitEntry>>;
}

export interface RuleHitEntry {
    readonly hits: number;
    readonly lastHit: string;
}

export type PruneReason = 'unused' | 'dead-globs' | 'dead-paths' | 'missing-deps';
export type PruneAction = 'delete' | 'remove-globs' | 'review';

export interface PruneFinding {
    readonly reason: PruneReason;
    readonly detail: string;
    /** Globs, paths or packages the finding is about. */
    readonly items: readonly string[];
}

export interface PruneCandidate {
    readonly rule: string;
    readonly path: string;
    readonly action: PruneAction;
    readonly findings: readonly PruneFinding[];
    /** Globs left after `remove-globs`. */
    readonly keepGlobs?: readonly string[];
}

export interface PruneOptions {
    readonly days: number;
    readonly now: Date;
    readonly hits?: RuleHitLog;
    /** When each rule file was added (ISO), e.g. from git; rules younger than `days` are never "unused". */
    readonly addedAt?: Readonly<Record<string, string>>;
}

export interface PrunePlan {
    readonly days: number;
    readonly rules: number;
    readonly candidates: readonly PruneCandidate[];
    /** Usage data covers fewer than `days` days, so "unused" is not reported yet. */
    readonly usageWindowShort: boolean;
    readonly trackingSince?: string;
}

/** A file to write, or delete when `content` is `null`. */
export interface KitWrite {
    readonly path: string;
    /** New content, or `null` to delete the file. */
    readonly content: string | null;
}
