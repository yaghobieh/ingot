import type { AgentSession } from './agents.types';
import { HEAVY_FILES, HEAVY_PLAN_STEPS } from './harmony';
import { HEAVY_TOOL_STEPS, LONG_RUN_MS, PROMPT_STEP_PATTERN, RUN_STATUSES } from './rex-handoff.consts';
import type { RexHandoffGate, RunWeight } from './rex-handoff.types';

export const promptSteps = (prompt: string): number => prompt.split('\n').filter(line => PROMPT_STEP_PATTERN.test(line)).length;

/** The weight of a chat's current run; `startedAt` is when the run began (undefined when it is not running). */
export const runWeight = (session: AgentSession, now: number, startedAt?: number, mentions: readonly string[] = []): RunWeight => {
    const lastUser = [...session.messages].reverse().find(m => m.role === 'user');
    const files = new Set([
        ...session.steps.filter(step => step.kind === 'edit').map(step => step.target),
        ...session.changes.map(change => change.label),
        ...(lastUser?.chips ?? []).map(chip => chip.path).filter(Boolean),
        ...mentions
    ]);
    return {
        active: RUN_STATUSES.includes(session.status),
        planSteps: session.plan.length,
        files: files.size,
        toolSteps: session.steps.length,
        promptSteps: promptSteps(lastUser?.text ?? ''),
        runningMs: startedAt === undefined ? 0 : Math.max(0, now - startedAt)
    };
};

/** Heavy: a running chat with many files, a multi-step plan (or prompt), many tool steps, or one that has run long. */
export const isHeavyRunWeight = (weight: RunWeight): boolean => weight.active && (
    weight.planSteps >= HEAVY_PLAN_STEPS
    || weight.promptSteps >= HEAVY_PLAN_STEPS
    || weight.files >= HEAVY_FILES
    || weight.toolSteps >= HEAVY_TOOL_STEPS
    || weight.runningMs >= LONG_RUN_MS
);

/** The one title bar T-rex: PRO+ (admins count) with Rex on the plan, the button on, and only during a heavy run. */
export const showRexHandoff = (gate: RexHandoffGate): boolean => gate.enabled && gate.proPlus && gate.canRex && gate.heavy;
