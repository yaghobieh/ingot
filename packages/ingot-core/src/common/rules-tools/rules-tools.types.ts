import type { ExportPlan, ExportTarget } from '../rules-kit';

export const RulesToolsService = Symbol('RulesToolsService');

/** Backend for the Rules tab's Export / Test / Prune (the same rules kit as the `ingot` CLI). `root` is the project folder path. */
export interface RulesToolsService {
    planExport(root: string, targets?: readonly ExportTarget[], force?: boolean): Promise<ExportPlan>;
    /** Writes the plan, then returns the fresh plan (no drift when everything was written). */
    applyExport(root: string, targets?: readonly ExportTarget[], force?: boolean): Promise<ExportPlan>;
}
