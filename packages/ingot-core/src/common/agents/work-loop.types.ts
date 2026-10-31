import type { PackageManager } from '../processes/processes.types';

export type E2eFramework = 'playwright' | 'cypress';

export interface PlannedCheck {
    readonly id: string;
    readonly command: string;
    readonly label: string;
}

export interface ProjectSignals {
    readonly manager?: PackageManager;
    readonly scripts: Readonly<Record<string, string>>;
    readonly files: readonly string[];
}

export interface CheckFailure {
    readonly file?: string;
    readonly line?: number;
    readonly message: string;
}

export interface CheckRun {
    readonly command: string;
    readonly passed: boolean;
    readonly output: string;
}

export interface LoopSnapshot {
    readonly wants: boolean;
    readonly edits: readonly string[];
    readonly checks: readonly CheckRun[];
    readonly fixAttempts: number;
    readonly e2eNudged: boolean;
    readonly commitNudged: boolean;
    readonly commitBlocked: boolean;
    readonly committed: boolean;
    readonly verifiedEdits: number;
}

/** Mutable per-turn state kept on the agent store (not in saved chat history). */
export interface LoopState extends LoopSnapshot {
    prompt: string;
    wants: boolean;
    edits: string[];
    checks: CheckRun[];
    fixAttempts: number;
    e2eNudged: boolean;
    commitNudged: boolean;
    commitBlocked: boolean;
    committed: boolean;
    verifiedEdits: number;
    required: string[];
    /** IDEA-282: hidden "continue" nudges sent this turn. */
    continues?: number;
    /** IDEA-282: the last reply promised more work while its edits wait for review. */
    promised?: boolean;
}

export interface SummaryInput {
    readonly files: readonly string[];
    readonly checks: readonly CheckRun[];
    readonly branch: string;
    readonly result: string;
}
