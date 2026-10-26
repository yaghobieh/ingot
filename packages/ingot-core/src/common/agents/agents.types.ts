export type AgentStatus = 'idle' | 'thinking' | 'editing' | 'review' | 'paused' | 'approval' | 'done' | 'error';
export type AgentMode = 'agent' | 'multi' | 'ask' | 'plan' | 'debug';
export type PlanState = 'done' | 'active' | 'todo';
export type StepKind = 'read' | 'edit' | 'run' | 'search';

export interface PlanItem {
    readonly text: string;
    readonly state: PlanState;
}

export interface AgentStep {
    readonly kind: StepKind;
    readonly target: string;
    readonly done: boolean;
    readonly added?: number;
    readonly removed?: number;
}

export interface AgentMessage {
    /** `peer` messages come from an agent in another project of the group (IDEA-53). */
    readonly role: 'user' | 'agent' | 'system' | 'peer' | 'tool';
    readonly text: string;
    readonly from?: string;
    /** What the model sees when it differs from the visible text (an expanded /command). */
    readonly expanded?: string;
    /** Context chips attached to a user message (IDEA-65), shown under it. */
    readonly chips?: readonly { readonly label: string; readonly path: string; readonly kind?: 'code' | 'file' | 'rule' | 'memory' }[];
    /** A user message's text and chips in the order they were typed (IDEA-98). */
    readonly parts?: readonly import('./composer-parts.types').SentPart[];
    /** Images on a user message (IDEA-98). Data is kept for this session only, not in saved history. */
    readonly images?: readonly import('./composer-parts.types').ImageChip[];
    /** A memory the agent saved from this reply (IDEA-77), with Undo. */
    readonly memory?: { readonly id: string; readonly scope: 'project' | 'global'; readonly undone?: boolean };
    /** A Plan-mode reply that can be built (IDEA-77). */
    readonly buildable?: boolean;
}

/** What went into the last request of a chat (IDEA-77): shown as chips and in the usage ring. */
export interface ChatContextInfo {
    readonly files: readonly string[];
    readonly rules: readonly string[];
    readonly memories: readonly { readonly id: string; readonly text: string }[];
    readonly usage: import('./context-usage').ContextUsage;
}

export interface FileChange {
    readonly uri: string;
    readonly label: string;
    readonly added: number;
    readonly removed: number;
}

export interface AgentSession {
    readonly id: string;
    title: string;
    status: AgentStatus;
    updatedAt: number;
    mode: AgentMode;
    model: string;
    messages: AgentMessage[];
    plan: PlanItem[];
    steps: AgentStep[];
    /** IDEA-109: the action waiting on the approval card (Skip / Always Run / Run). */
    approval?: import('./agent-actions').PendingApproval;
    changes: FileChange[];
    /** File the agent is currently working on, for the list subtitle. */
    activeFile?: string;
    /** Project root URI the agent works in; set inside project groups (IDEA-52). */
    project?: string;
    /** Open as a tab in the Agents panel (closed chats stay in History). */
    open?: boolean;
    openedAt?: number;
    pinned?: boolean;
    context?: ChatContextInfo;
    /** Multi-agent: the chat that started this sub-agent. */
    parent?: string;
    /** IDEA-105 checkpoint: the run stopped for review after `applied` of `total` files. */
    pause?: ReviewPause;
}

export interface ReviewPause {
    readonly applied: number;
    readonly total: number;
    /** Epoch ms when the run continues by itself; undefined = waits for Continue (or the countdown was cancelled). */
    readonly continueAt?: number;
}

export interface ModelOption {
    readonly id: string;
    readonly label: string;
}
