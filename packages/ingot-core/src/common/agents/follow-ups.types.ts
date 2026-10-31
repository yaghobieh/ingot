export type CheckOutcome = 'none' | 'passed' | 'failed';

/** What the finished turn did, for the default follow-ups. */
export interface FollowUpSignals {
    readonly edited: boolean;
    readonly checks: CheckOutcome;
}
