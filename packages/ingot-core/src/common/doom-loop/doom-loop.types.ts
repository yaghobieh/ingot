/**
 * IDEA-304 Doom-Loop Breaker: notices an agent run going in circles (the same error again and again, fixes that break
 * something they fixed before, "fixed" claims the next result disproves), pauses it and keeps the failed approach as an
 * anti-habit in `.ingot/anti-habits.md`.
 */
export type DoomKind = 'repeat' | 'cycle' | 'claims';

/** One step of the run: a command or check with its outcome, or the files an edit changed. */
export interface DoomAttempt {
    readonly action: string;
    readonly files: readonly string[];
    readonly failed: boolean;
    readonly signature?: string;
}

export interface DoomState {
    readonly attempts: readonly DoomAttempt[];
    /** Content hashes per edited file, oldest first. */
    readonly hashes: Readonly<Record<string, readonly string[]>>;
    /** A file the agent put back to an earlier version (fix → break → same fix). */
    readonly oscillated?: string;
    /** The agent's latest "fixed / passes now" claim, until the next result. */
    readonly claim?: string;
    /** Claims the next result disproved. */
    readonly falseClaims: readonly string[];
}

export interface DoomResult {
    readonly action: string;
    readonly failed: boolean;
    readonly output: string;
}

export interface DoomVerdict {
    readonly kind: DoomKind;
    /** One sentence: why the run was paused. */
    readonly reason: string;
    readonly signature?: string;
    /** "Here's what I tried", newest last. */
    readonly tried: readonly string[];
    /** The failed approach in one line (saved as the anti-habit). */
    readonly approach: string;
    readonly files: readonly string[];
}

export interface AntiHabit {
    readonly id: string;
    readonly text: string;
    readonly signature?: string;
    readonly files: readonly string[];
    readonly count: number;
    readonly at: string;
}
