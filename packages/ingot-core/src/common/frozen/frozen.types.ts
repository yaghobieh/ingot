/**
 * IDEA-303 Frozen Zones: files and functions agents may not change without the user's explicit approval in the chat,
 * kept in `.ingot/frozen.json`.
 */
export type FrozenSource = 'user' | 'inferred' | 'learned';

export interface FrozenZone {
    readonly id: string;
    /** Project-relative path (`src/payments/charge.ts`). */
    readonly path: string;
    /** A function, method or class inside the file; the whole file when absent. */
    readonly symbol?: string;
    readonly source: FrozenSource;
    readonly reason?: string;
    readonly at: number;
}

export interface TestRun {
    readonly command: string;
    readonly passed: boolean;
    readonly at: number;
}

export interface FrozenState {
    readonly version: number;
    readonly zones: readonly FrozenZone[];
    /** Agent edits the user rejected, per path ("you always revert edits to X"). */
    readonly reverts: Readonly<Record<string, number>>;
    /** Paths whose freeze suggestion the user turned down. */
    readonly dismissed: readonly string[];
    /** The last test run Ingot saw (agent checks and tool calls); inference needs it green. */
    readonly tests?: TestRun;
}

export interface NewZone {
    readonly path: string;
    readonly symbol?: string;
    readonly source: FrozenSource;
    readonly reason?: string;
}

export interface LineRange {
    readonly start: number;
    /** Inclusive. */
    readonly end: number;
}

/** A frozen zone an edit would change. */
export interface FrozenTouch {
    readonly zone: FrozenZone;
    readonly label: string;
}

/** A source file with a test next to it and its last commit time. */
export interface InferInput {
    readonly path: string;
    readonly test: string;
    readonly lastCommit?: number;
}

export interface InferCandidate {
    readonly path: string;
    readonly test: string;
    readonly ageDays: number;
}
