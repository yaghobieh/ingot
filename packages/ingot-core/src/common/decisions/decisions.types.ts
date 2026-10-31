/**
 * IDEA-302 Decision Ledger: choices agreed between the user and the agent, kept in `.ingot/decisions.md`. Locked
 * decisions are checked before the agent applies edits, plans or commands.
 */
export interface Decision {
    readonly id: string;
    readonly text: string;
    readonly locked: boolean;
    /** How many times the user confirmed it (captured again or re-stated). */
    readonly confirmed: number;
    /** Terms an edit, plan or command may not introduce while the decision is locked (`sqlite`, `npm`). */
    readonly avoid: readonly string[];
    /** Day it was first recorded (`2026-10-31`). */
    readonly at: string;
    /** The rule file it became once confirmed often enough (`.ingot/rules/decision-use-postgres.md`). */
    readonly habit?: string;
}

export interface DecisionCapture {
    readonly decisions: Decision[];
    /** Decisions locked by this capture (new or confirmed again). */
    readonly captured: Decision[];
    /** Decisions that reached the habit threshold with this capture. */
    readonly promoted: Decision[];
}

/** What the agent is about to do, checked against locked decisions. */
export interface DecisionCandidate {
    readonly plan: readonly string[];
    readonly edits: readonly { readonly path: string; readonly added: readonly string[] }[];
    readonly commands: readonly string[];
}

export interface DecisionConflict {
    readonly decision: Decision;
    readonly term: string;
    /** Where the term showed up: `src/db.ts`, `plan`, `command npm install`. */
    readonly where: string;
}

export interface DecisionRuleFile {
    readonly path: string;
    readonly content: string;
}
