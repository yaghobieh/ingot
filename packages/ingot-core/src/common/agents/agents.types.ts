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
    /** IDEA-259: the checklist text when "<verb> <target>" would read as a raw tool id. */
    readonly label?: string;
}

export interface AgentMessage {
    /** `peer` messages come from an agent in another project of the group (IDEA-53). */
    readonly role: 'user' | 'agent' | 'system' | 'peer' | 'tool';
    readonly text: string;
    readonly from?: string;
    /** IDEA-186: sent to the model but not shown (e.g. the nudge to run commands instead of printing them). */
    readonly hidden?: boolean;
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
    /** IDEA-177: the tool call behind a `tool` message, drawn as a rich card (terminal block, profile, …). */
    readonly tool?: import('./tool-cards').ToolCallInfo;
    /** IDEA-181: subagent chats this line refers to; shown as a one-line reference that opens the Subagents strip. */
    readonly refs?: readonly string[];
    /** Like and heart on this message. Kept with the saved chat. */
    readonly reactions?: readonly import('./chat-round.types').ReactionKind[];
    /** IDEA-267: IDE context attached to a user message (labels only), shown under it. */
    readonly auto?: readonly import('./auto-context.types').SentAutoContext[];
    /** IDEA-267: suggested next prompts under the final reply of a turn. */
    readonly followUps?: readonly string[];
    /** When a think block opened, and how long it lasted once it closed. */
    readonly thoughtStarted?: number;
    readonly thoughtMs?: number;
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
    /** IDEA-266: the workspace (folder or workspace file URI) of the window the chat belongs to. */
    workspace?: string;
    /** IDEA-268 / IDEA-291: the chat (or task subagent) works in its own git worktree instead of the project folder; `path` is a URI. */
    worktree?: import('../threads/threads.types').ThreadWorktree;
    /** Open as a tab in the Agents panel (closed chats stay in History). */
    open?: boolean;
    openedAt?: number;
    pinned?: boolean;
    context?: ChatContextInfo;
    /** Multi-agent: the chat that started this sub-agent. */
    parent?: string;
    /** IDEA-180: `zaprex` for a Harmony mode piece Zaprex runs next to the agent. */
    agent?: 'ingot' | 'zaprex';
    /** IDEA-180: the files this chat may change (globs); others are locked to the lead agent. */
    scope?: readonly string[];
    /** IDEA-180: which Harmony piece this is. */
    piece?: import('./harmony').HarmonyPieceKind;
    /** IDEA-185: the piece runs in the Zaprex desktop app (handoff id), with its streamed progress (0..1) and status line. */
    handoff?: { readonly id: string; readonly progress?: number; readonly message?: string; readonly desktop: true };
    /** IDEA-105 checkpoint: the run stopped for review after `applied` of `total` files. */
    pause?: ReviewPause;
    /** A question the agent is waiting on. Cleared when the user answers or stops. */
    ask?: { readonly question: string; readonly options?: readonly string[] };
    /** IDEA-296: the habit (scenario playbook) this chat follows, with its live checklist. */
    habit?: import('../habits/playbook.types').ActiveHabit;
    /** IDEA-292: a `/goal` run: the agent keeps taking turns until its self-check passes. */
    goal?: import('./goal.types').AgentGoal;
    /** IDEA-292: a command or skill pinned into this chat's system prompt ("Use as mode"). */
    customMode?: import('./custom-mode.types').CustomMode;
    /** IDEA-290: the `.ingot/artifacts/<runId>` folder of the latest run, once something was written. */
    artifactsRun?: string;
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
