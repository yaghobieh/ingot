/**
 * IDEA-316 rules engine: one model of every rule file (`.ingot/rules`, other editors' rule folders, AGENTS.md, nested
 * ones, global and habit files) shared by the Rules Doctor (IDEA-317), rule hits (IDEA-318), `.ingot` schemas
 * (IDEA-321) and the effective-rules view (IDEA-327). Pure TypeScript: the IDE and the `ingot` CLI run the same code.
 */

/** `ingot`: `.ingot/rules`; `external`: `.cursor/rules`; `legacy`: `.alloy/rules`; `agents`: AGENTS.md / CLAUDE.md / .cursorrules. */
export type RuleSource = 'ingot' | 'external' | 'legacy' | 'agents' | 'global' | 'habit';

/** How a rule loads (as Cursor): every turn, by globs, when the agent asks for it, or only when @-mentioned. */
export type RuleKind = 'always' | 'auto' | 'agent' | 'manual';

export type Severity = 'error' | 'warning' | 'info';

/** Zero-based line and column (character) positions. */
export interface TextRange {
    readonly line: number;
    readonly column: number;
    readonly endLine: number;
    readonly endColumn: number;
}

export type FrontmatterValue = string | boolean | number | readonly string[];

export interface FrontmatterItem {
    readonly value: string;
    readonly range: TextRange;
}

export interface FrontmatterEntry {
    readonly key: string;
    readonly value: FrontmatterValue;
    /** The key itself. */
    readonly keyRange: TextRange;
    /** The value as written (the whole `[a, b]` list, or the key line for a `- item` list). */
    readonly valueRange: TextRange;
    /** Each list item (inline `[a, b]` or `- item` lines). */
    readonly items: readonly FrontmatterItem[];
}

export interface FrontmatterProblem {
    readonly message: string;
    readonly range: TextRange;
}

export interface ParsedFrontmatter {
    /** False when the file has no `---` block. */
    readonly present: boolean;
    /** True when the block opens with `---` but never closes. */
    readonly unclosed: boolean;
    readonly entries: readonly FrontmatterEntry[];
    readonly data: Readonly<Record<string, FrontmatterValue>>;
    readonly body: string;
    /** Line of the first body line (after the closing `---`). */
    readonly bodyLine: number;
    /** Line of the closing `---` (or -1). */
    readonly endLine: number;
    readonly problems: readonly FrontmatterProblem[];
}

/** A rule file read from disk (or the user's global folder, paths starting with `~/`). */
export interface RuleFileInput {
    readonly path: string;
    readonly text: string;
}

export interface RuleDoc {
    /** Same as `path`; unique. */
    readonly id: string;
    /** Display name: file name without extension (`AGENTS.md` for agent files), `scope/name` for nested rules. */
    readonly name: string;
    /** Name without the scope, used for override matching across folders. */
    readonly baseName: string;
    /** Project-relative path, or `~/.ingot/...` for global rules. */
    readonly path: string;
    readonly source: RuleSource;
    readonly kind: RuleKind;
    /** Project-relative folder a nested rule applies under; `''` for root and global rules. */
    readonly scope: string;
    readonly globs: readonly string[];
    readonly description?: string;
    readonly body: string;
    /** File line of the body's first line (body line `i` is file line `bodyLine + i`). */
    readonly bodyLine: number;
    readonly tokens: number;
    readonly lines: number;
    /** Store pack the rule came from (frontmatter `pack`), when known from the file itself. */
    readonly pack?: string;
    readonly frontmatter: ParsedFrontmatter;
}

/** A rule as the IDE already loaded it (ProjectRule), converted without reading the file again. */
export interface LoadedRule {
    readonly name: string;
    readonly path: string;
    readonly source: string;
    readonly body: string;
    readonly globs: readonly string[];
    readonly alwaysApply: boolean;
    readonly description?: string;
    readonly kind?: RuleKind;
    readonly scope?: string;
}

/** What the engine needs from the disk: every project file (relative, `/`-separated) and a reader. */
export interface RulesWorkspace {
    readonly files: readonly string[];
    readonly read: (path: string) => string | undefined;
    /** `~/.ingot/rules/*`, `~/.ingot/AGENTS.md` (paths start with `~/`). */
    readonly globalFiles?: readonly RuleFileInput[];
}

export type DoctorCode =
    | 'conflict' | 'override' | 'dead-glob' | 'duplicate' | 'duplicate-line' | 'shadowed'
    | 'oversized' | 'budget' | 'empty' | 'manual-only' | 'schema';

export interface RelatedLocation {
    readonly path: string;
    readonly range?: TextRange;
    readonly message?: string;
}

export interface DoctorFinding {
    readonly code: DoctorCode;
    readonly severity: Severity;
    readonly message: string;
    readonly path: string;
    readonly range?: TextRange;
    readonly related?: readonly RelatedLocation[];
}

export interface RuleCost {
    readonly id: string;
    readonly name: string;
    readonly path: string;
    readonly kind: RuleKind;
    readonly source: RuleSource;
    readonly scope: string;
    readonly tokens: number;
    /** Loaded every turn (for files under its scope). */
    readonly alwaysOn: boolean;
    /** Never loads: another file with the same name wins. */
    readonly shadowed: boolean;
}

/** Always-on tokens for files under one folder (root `''` plus each nested rule folder). */
export interface BudgetUsage {
    readonly scope: string;
    readonly tokens: number;
    readonly budget: number;
    readonly over: boolean;
    readonly rules: readonly string[];
}

export interface DoctorOptions {
    /** Always-on token budget per turn. */
    readonly budget?: number;
    /** A single rule above this many tokens is oversized. */
    readonly maxRuleTokens?: number;
    /** Finding codes to leave out. */
    readonly ignore?: readonly DoctorCode[];
}

/** `.ingot/doctor.json`. */
export type DoctorConfig = DoctorOptions;

export interface DoctorSummary {
    readonly errors: number;
    readonly warnings: number;
    readonly infos: number;
}

export interface DoctorReport {
    readonly rules: readonly RuleCost[];
    readonly findings: readonly DoctorFinding[];
    readonly budgets: readonly BudgetUsage[];
    /** Root always-on tokens (what every turn pays at least). */
    readonly alwaysOnTokens: number;
    readonly budget: number;
    readonly summary: DoctorSummary;
}

/** A sentence that tells the agent to do (+1) or not do (-1) something. */
export interface Directive {
    readonly polarity: 1 | -1;
    /** Normalized object ("tabs", "default exports"). */
    readonly object: string;
    readonly text: string;
    /** File line (zero-based). */
    readonly line: number;
}

export interface DirectiveConflict {
    readonly a: Directive;
    readonly b: Directive;
    readonly reason: 'opposite' | 'exclusive';
}

export type RuleHitCode = 'always' | 'agents-file' | 'nested-agents' | 'glob' | 'mention' | 'agent-requested' | 'habit' | 'loaded';

export interface RuleHitReason {
    readonly code: RuleHitCode;
    readonly label: string;
    readonly detail: string;
    readonly glob?: string;
    readonly file?: string;
}

/** One rule, AGENTS.md or habit that went into an agent turn, and why. */
export interface RuleHit {
    readonly id: string;
    readonly name: string;
    readonly path: string;
    readonly source: RuleSource;
    readonly kind: RuleKind;
    readonly scope: string;
    readonly tokens: number;
    readonly reason: RuleHitReason;
}

export interface RuleHitInput {
    /** Rules the turn loaded (or would load). */
    readonly applied: readonly RuleDoc[];
    /** Files in context (attached, open, touched), project-relative. */
    readonly files: readonly string[];
    readonly prompt?: string;
    /** Habits the turn used. */
    readonly habits?: readonly HabitMatch[];
}

export interface HabitMatch {
    readonly doc: RuleDoc;
    readonly score: number;
    readonly detail: string;
}

export type LayerKind = 'global' | 'root' | 'package' | 'folder';

export interface EffectiveLayer {
    readonly scope: string;
    readonly kind: LayerKind;
    readonly label: string;
}

export type EffectiveStatus = 'applied' | 'available' | 'manual' | 'not-matching' | 'overridden' | 'shadowed';

export interface LineOverride {
    readonly line: number;
    readonly text: string;
    readonly by: string;
    readonly byLine: number;
    readonly byText: string;
}

export interface EffectiveEntry {
    readonly id: string;
    readonly name: string;
    readonly path: string;
    readonly source: RuleSource;
    readonly kind: RuleKind;
    readonly layer: string;
    readonly status: EffectiveStatus;
    readonly reason: string;
    readonly tokens: number;
    /** The rule that replaces this one (deeper folder, closer AGENTS.md, or higher-priority folder). */
    readonly overriddenBy?: string;
    /** Rules this one replaces. */
    readonly overrides: readonly string[];
    /** Lines a deeper rule contradicts (it wins for this file). */
    readonly lineOverrides: readonly LineOverride[];
    /** Same-folder contradictions (both apply; the doctor flags them). */
    readonly conflicts: readonly LineOverride[];
}

export interface EffectiveRules {
    readonly file: string;
    readonly layers: readonly EffectiveLayer[];
    readonly entries: readonly EffectiveEntry[];
    /** What the agent reads for this file, root first, most specific last. */
    readonly merged: string;
    readonly tokens: number;
}

export type JsonType = 'object' | 'array' | 'string' | 'number' | 'integer' | 'boolean' | 'null';
export type JsonLiteral = string | number | boolean;

/** The JSON Schema (draft-07) subset Ingot's `.ingot` schemas use. */
export interface JsonSchema {
    readonly $schema?: string;
    readonly $id?: string;
    readonly title?: string;
    readonly description?: string;
    readonly type?: JsonType | readonly JsonType[];
    readonly properties?: Readonly<Record<string, JsonSchema>>;
    readonly required?: readonly string[];
    readonly additionalProperties?: boolean | JsonSchema;
    readonly items?: JsonSchema;
    readonly enum?: readonly JsonLiteral[];
    readonly pattern?: string;
    readonly minimum?: number;
    readonly maximum?: number;
    readonly minLength?: number;
    readonly minItems?: number;
    /** At least one must match (used for "command or url"). */
    readonly anyOf?: readonly JsonSchema[];
    readonly default?: unknown;
    readonly examples?: readonly unknown[];
    /** Ingot extension: the string is a glob list item; checked for syntax and previewed. */
    readonly format?: 'glob' | 'regex';
}

export type SchemaFormat = 'frontmatter' | 'json';

export interface IngotFileSchema {
    readonly id: string;
    readonly title: string;
    readonly format: SchemaFormat;
    /** Matches project-relative (or absolute) paths, `/`-separated. */
    readonly pattern: RegExp;
    readonly schema: JsonSchema;
    /** A starter for an empty file (completion). */
    readonly template: string;
}

export interface SchemaDiagnostic {
    readonly severity: Severity;
    readonly message: string;
    readonly range: TextRange;
    /** Key path of the value (`mcpServers.db.command`, or the frontmatter key). */
    readonly path: string;
}

export type JsonNodeType = 'object' | 'array' | 'string' | 'number' | 'boolean' | 'null';

export interface JsonNode {
    readonly type: JsonNodeType;
    readonly offset: number;
    readonly length: number;
    readonly value?: JsonLiteral | null;
    /** Object properties in order (key node + value node). */
    readonly properties?: readonly JsonProperty[];
    readonly items?: readonly JsonNode[];
}

export interface JsonProperty {
    readonly key: string;
    readonly keyOffset: number;
    readonly keyLength: number;
    readonly value?: JsonNode;
}

export interface JsonParseError {
    readonly message: string;
    readonly offset: number;
    readonly length: number;
}

export interface JsonParse {
    readonly root?: JsonNode;
    readonly errors: readonly JsonParseError[];
}

export type ProvenanceSource = 'frontmatter' | 'lockfile' | 'extension';

export interface PackInfo {
    readonly name: string;
    readonly version?: string;
    readonly from: ProvenanceSource;
}

export interface CommitInfo {
    readonly sha: string;
    readonly author: string;
    readonly email: string;
    readonly date: string;
    readonly subject: string;
}

/** Who wrote a rule and where it came from (git and the store pack). */
export interface RuleProvenance {
    readonly path: string;
    readonly sourceLabel: string;
    readonly lastCommit?: CommitInfo;
    readonly firstCommit?: CommitInfo;
    /** Changed since the last commit, or never committed. */
    readonly uncommitted: boolean;
    readonly pack?: PackInfo;
}
