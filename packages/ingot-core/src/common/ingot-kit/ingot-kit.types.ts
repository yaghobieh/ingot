/** Shared `.ingot` kit types: rule packs and the lockfile (IDEA-322), specs (IDEA-324), policy.yaml (IDEA-325, IDEA-326). */

export type YamlScalar = string | number | boolean | null;
export type YamlValue = YamlScalar | YamlValue[] | YamlMap;
export interface YamlMap { [key: string]: YamlValue }

export interface SemVer {
    readonly major: number;
    readonly minor: number;
    readonly patch: number;
    readonly prerelease: readonly string[];
}

/** `2`, `2.1` or `2.x`: a version whose missing parts are wildcards. */
export interface PartialVersion {
    readonly major?: number;
    readonly minor?: number;
    readonly patch?: number;
    readonly prerelease: readonly string[];
}

/** One `>=1.2.0`-style bound; a range is a list of alternatives (`||`), each a list of bounds that must all hold. */
export interface Comparator {
    readonly op: '>' | '>=' | '<' | '<=' | '=';
    readonly version: SemVer;
}

/** `@acme/react-rules@^2` (or `acme.react-rules@^2`). */
export interface PackSpec {
    readonly publisher: string;
    readonly name: string;
    /** Semver range; `latest` when none was given. */
    readonly range: string;
    /** `@acme/react-rules`, the lockfile key. */
    readonly key: string;
    /** `acme.react-rules`, the store id. */
    readonly id: string;
}

export type PackSource = 'project' | 'org';

export interface LockedPack {
    /** Store id (`acme.react-rules`). */
    readonly id: string;
    /** The range that was asked for (`^2`). */
    readonly range: string;
    readonly version: string;
    /** Download URL of that exact version. */
    readonly resolved: string;
    /** `sha256-<hex>` of the .ingotx archive. */
    readonly integrity: string;
    /** Org-enforced: cannot be removed, downgraded out of the org range, edited or overridden by project rules. */
    readonly enforced: boolean;
    readonly source: PackSource;
    readonly type: string;
    /** Project-relative files the pack wrote. */
    readonly files: readonly string[];
    /** `sha256-<hex>` per written file, so `ingot packs verify` sees local edits. */
    readonly hashes: Readonly<Record<string, string>>;
}

export interface PackLock {
    readonly lockfileVersion: number;
    readonly registry?: string;
    readonly packs: Readonly<Record<string, LockedPack>>;
    /** The team the org packs came from, and when they were last synced. */
    readonly org?: { readonly team: string; readonly syncedAt: string };
}

/** What a team admin set in the store: packs every project of the team gets. */
export interface OrgPack {
    readonly id: string;
    readonly range: string;
    readonly enforced: boolean;
}

/** `GET /api/marketplace/<id>/versions?range=` */
export interface PackVersionInfo {
    readonly version: string;
    readonly publishedAt: string;
    /** Hex SHA-256 of the .ingotx archive. */
    readonly sha256: string;
}

export interface PackVersionsResponse {
    readonly id: string;
    readonly type: string;
    readonly latest: string;
    /** Newest first. */
    readonly versions: readonly PackVersionInfo[];
    /** The newest version inside `range`; null when none matches. */
    readonly resolved: string | null;
    readonly range: string;
}

/** `GET /api/store/team-packs` */
export interface TeamPacksResponse {
    readonly team: { readonly id: string; readonly name: string } | null;
    readonly packs: readonly OrgPack[];
}

export interface OrgSyncPlan {
    /** Org packs to install or update (missing, or the locked version is outside the org range). */
    readonly install: readonly OrgPack[];
    /** Installed packs whose `enforced` / `source` must change to match the org list. */
    readonly mark: readonly { readonly key: string; readonly enforced: boolean }[];
    /** Packs the org no longer enforces (they stay installed as project packs). */
    readonly release: readonly string[];
}

/** The parts of an .ingotx manifest an install reads. */
export interface PackManifest {
    readonly publisher: string;
    readonly name: string;
    readonly version: string;
    readonly type: string;
    readonly displayName?: string;
    readonly contributes?: {
        readonly rules?: readonly { readonly path: string }[];
        readonly commands?: readonly { readonly name: string; readonly path: string }[];
    };
}

export interface PlannedFile {
    readonly path: string;
    readonly content: string;
}

export type LockIssueKind = 'missing-file' | 'modified-file' | 'missing-enforced' | 'not-enforced' | 'range-mismatch';

export interface LockIssue {
    readonly kind: LockIssueKind;
    readonly pack: string;
    readonly path?: string;
    readonly message: string;
}

export interface RuleRef {
    readonly name: string;
    readonly path: string;
}

export interface SpecTask {
    /** `2.1` from the list, or the 1-based position when the item has no number. */
    readonly id: string;
    readonly title: string;
    readonly done: boolean;
    /** 0-based line in tasks.md. */
    readonly line: number;
    readonly depth: number;
    /** Requirement numbers from a `_Requirements: 1.1, 2_` line under the task. */
    readonly requirements: readonly string[];
}

export interface SpecProgress {
    readonly done: number;
    readonly total: number;
}

export type SpecDoc = 'requirements' | 'design' | 'tasks';

export interface SpecSummary {
    readonly slug: string;
    readonly title: string;
    readonly dir: string;
    readonly docs: readonly SpecDoc[];
    readonly tasks: readonly SpecTask[];
    readonly progress: SpecProgress;
}

export type AutoApproveLevel = 'none' | 'read' | 'commands' | 'all';

/** The approval kinds the agent shows a card for (same names as the IDE's approval settings). */
export type ApprovalKindName = 'git' | 'terminal' | 'web' | 'browser' | 'mcp' | 'delete';

export interface ModelPrice {
    /** USD per million input tokens. */
    readonly input: number;
    /** USD per million output tokens. */
    readonly output: number;
}

/** `.ingot/policy.yaml` as written: every key optional. */
export interface IngotPolicy {
    readonly version?: number;
    readonly secrets?: {
        readonly denyRead?: readonly string[];
        readonly redact?: {
            readonly patterns?: readonly string[];
            readonly envFiles?: boolean;
            readonly envVars?: readonly string[];
        };
    };
    readonly network?: { readonly allowedDomains?: readonly string[] };
    readonly commands?: { readonly allowed?: readonly string[] };
    readonly audit?: boolean;
    readonly model?: string;
    readonly budget?: { readonly maxCostPerRun?: number; readonly price?: ModelPrice };
    readonly autoApprove?: AutoApproveLevel;
}

export interface PolicyParse {
    readonly policy: IngotPolicy;
    readonly errors: readonly string[];
}

/** One policy.yaml and the project folder it governs (`''` for the root). */
export interface PolicyLayer {
    readonly dir: string;
    readonly file: string;
    readonly policy: IngotPolicy;
}

/** A value and the policy file it came from. */
export interface Sourced<T> {
    readonly value: T;
    readonly file: string;
}

/** A glob from a policy, with the folder it is relative to. */
export interface ScopedPattern {
    readonly pattern: string;
    readonly dir: string;
    readonly file: string;
}

/** The policy that applies to one path: nearest file wins for settings, deny and redact lists add up. */
export interface EffectivePolicy {
    readonly layers: readonly string[];
    readonly denyRead: readonly ScopedPattern[];
    readonly redactPatterns: readonly Sourced<string>[];
    readonly redactEnvFiles: boolean;
    readonly redactEnvVars: readonly string[];
    readonly allowedDomains?: Sourced<readonly string[]>;
    readonly allowedCommands?: Sourced<readonly string[]>;
    readonly audit: boolean;
    readonly model?: Sourced<string>;
    readonly maxCostPerRun?: Sourced<number>;
    readonly price?: Sourced<ModelPrice>;
    readonly autoApprove?: Sourced<AutoApproveLevel>;
}

export type PolicyRule = 'secrets.denyRead' | 'commands.allowed' | 'network.allowedDomains' | 'budget.maxCostPerRun' | 'packs.enforced';

export interface PolicyViolation {
    readonly rule: PolicyRule;
    /** The glob, command or host that broke the rule. */
    readonly subject: string;
    readonly file: string;
    readonly message: string;
}

export type ApprovalVerdict = 'auto' | 'ask' | 'default';
