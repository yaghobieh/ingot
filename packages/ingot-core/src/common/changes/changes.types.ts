/** Agent code changes shown as blocks in the chat and reviewed hunk by hunk in the editor (IDEA-102). */
export type ChangeStatus = 'streaming' | 'applied' | 'accepted' | 'rejected' | 'partial';
export type HunkState = 'pending' | 'accepted' | 'rejected';

export interface ChangeHunk {
    readonly id: string;
    /** Zero-based start lines in the old / new text. */
    readonly oldStart: number;
    readonly newStart: number;
    readonly removed: readonly string[];
    readonly added: readonly string[];
    readonly state: HunkState;
}

export interface CodeChange {
    readonly id: string;
    readonly sessionId: string;
    /** Index of the agent message the block renders under. */
    readonly messageIndex: number;
    /** Project-relative path shown in the block. */
    readonly path: string;
    readonly uri: string;
    readonly oldText: string;
    readonly newText: string;
    /** The file did not exist before the edit (rejecting removes it). */
    readonly created: boolean;
    readonly hunks: readonly ChangeHunk[];
    readonly status: ChangeStatus;
}

/** IDEA-262: an agent edit reached a file. `before` when it lands for review, `after` once decided, right before the save. */
export interface AgentEditEvent {
    readonly uri: string;
    readonly sessionId: string;
    readonly phase: 'before' | 'after';
    readonly text: string;
}

/** File contents before an agent run, keyed by URI; `undefined` = the file did not exist (IDEA-102 checkpoints). */
export interface Checkpoint {
    readonly sessionId: string;
    /** The user message whose run this checkpoint precedes. */
    readonly messageIndex: number;
    readonly files: Readonly<Record<string, string | undefined>>;
}
