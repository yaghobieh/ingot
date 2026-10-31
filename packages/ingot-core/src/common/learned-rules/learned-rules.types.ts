export type LearnedSource = 'rejection' | 'correction';
export type LearnedStatus = 'pending' | 'accepted' | 'dismissed';

/** A rule Ingot drafted from your reviews; nothing is written to `.ingot/rules` until you accept it. */
export interface LearnedRuleProposal {
    readonly id: string;
    /** What the proposal is about (`rejection:<pattern>` or the correction's words); one proposal per key, ever. */
    readonly key: string;
    readonly source: LearnedSource;
    readonly title: string;
    /** `.ingot/rules/learned-<slug>.md` */
    readonly path: string;
    readonly globs: readonly string[];
    readonly body: string;
    /** Rejected code lines, or the messages that repeated the correction. */
    readonly evidence: readonly string[];
    readonly status: LearnedStatus;
    readonly createdAt: string;
    readonly decidedAt?: string;
}

export interface CorrectionRecord {
    readonly text: string;
    readonly words: readonly string[];
    readonly at: string;
}

export interface LearnedRulesState {
    readonly version: number;
    readonly corrections: readonly CorrectionRecord[];
    readonly proposals: readonly LearnedRuleProposal[];
}

export interface RejectedHunk {
    /** Project-relative path of the file. */
    readonly path: string;
    readonly added: readonly string[];
    readonly removed: readonly string[];
}

export interface RejectionPattern {
    readonly id: string;
    readonly test: RegExp;
    readonly title: string;
    readonly body: string;
}

export interface LearnResult {
    readonly state: LearnedRulesState;
    readonly proposal?: LearnedRuleProposal;
}
