import type { SpecSummary, SpecTask } from '../../common/ingot-kit';

/** Runs one spec task with the agent (wired by the contribution, which owns the agent store). */
export const SpecTaskRunner = Symbol('IngotSpecTaskRunner');
export interface SpecTaskRunner {
    runTask(spec: SpecSummary, task: SpecTask): Promise<void>;
}
