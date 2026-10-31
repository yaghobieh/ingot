/** IDEA-305 Fresh-Context Auto-Handoff: signs a chat has gone stale ("context rot") and the brief a fresh agent starts from. */
export type RotReason = 'failures' | 'turns' | 'tokens';
export type FreshContextMode = 'off' | 'offer' | 'auto';

export interface RotSignals {
    /** Visible user turns in the chat. */
    readonly turns: number;
    /** Failed tool calls, checks and model requests since the last user turn. */
    readonly failures: number;
    /** Share of the context window the last request used (0..1). */
    readonly ratio: number;
}

export interface RotLimits {
    readonly turns: number;
    readonly failures: number;
    readonly ratio: number;
}

export interface RotVerdict {
    readonly reasons: readonly RotReason[];
    readonly signals: RotSignals;
}

/** What the brief is distilled from. */
export interface BriefInput {
    readonly title: string;
    readonly savedAt: string;
    readonly goal: string;
    readonly latest: string;
    readonly verdict: RotVerdict;
    readonly plan: readonly { readonly text: string; readonly done: boolean }[];
    /** `.ingot/decisions.md` when the project has one. */
    readonly decisions?: string;
    readonly files: readonly string[];
    readonly diff: string;
    readonly failures: readonly string[];
    /** The last agent reply (where the old chat stopped). */
    readonly lastReply: string;
}

/** Shown above the composer when a stale chat is detected (offer mode). */
export interface HandoffOffer {
    readonly verdict: RotVerdict;
}
