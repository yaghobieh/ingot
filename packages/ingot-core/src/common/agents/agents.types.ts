export type AgentStatus = 'idle' | 'thinking' | 'editing' | 'review' | 'done' | 'error';
export type AgentMode = 'agent' | 'ask' | 'plan';
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
    readonly role: 'user' | 'agent' | 'system';
    readonly text: string;
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
    changes: FileChange[];
    /** File the agent is currently working on, for the list subtitle. */
    activeFile?: string;
    /** Project root URI the agent works in; set inside project groups (IDEA-52). */
    project?: string;
}

export interface ModelOption {
    readonly id: string;
    readonly label: string;
}
