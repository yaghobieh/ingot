import type { ExportPlan, ExportTarget, RuleTestReport } from '../rules-kit';

export const RulesToolsService = Symbol('RulesToolsService');

export interface RuleTestSummary {
    readonly id: string;
    readonly name: string;
    readonly file: string;
    readonly runs: number;
}

export interface RuleTestListing {
    readonly cases: readonly RuleTestSummary[];
    readonly errors: readonly string[];
    /** An OpenRouter key is in the keychain (or OPENROUTER_API_KEY is set); the key itself never leaves the backend. */
    readonly keyConfigured: boolean;
    /** The last run, from `.ingot/.state/rules-test-report.json` (also written by `ingot rules test`). */
    readonly lastReport?: RuleTestReport;
}

export interface RuleTestRequest {
    /** OpenRouter model id, or `mock` for the free deterministic model. */
    readonly model: string;
    /** Hard cap for the run in USD; clamped to the kit's ceiling. */
    readonly maxCostUsd: number;
    /** Test names or files; all tests when empty. */
    readonly only?: readonly string[];
}

/** Backend for the Rules tab's Export / Test / Prune (the same rules kit as the `ingot` CLI). `root` is the project folder path. */
export interface RulesToolsService {
    planExport(root: string, targets?: readonly ExportTarget[], force?: boolean): Promise<ExportPlan>;
    /** Writes the plan, then returns the fresh plan (no drift when everything was written). */
    applyExport(root: string, targets?: readonly ExportTarget[], force?: boolean): Promise<ExportPlan>;
    listRuleTests(root: string): Promise<RuleTestListing>;
    runRuleTests(root: string, request: RuleTestRequest): Promise<RuleTestReport>;
}
