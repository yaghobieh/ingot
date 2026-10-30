import type { AgentMessage, AgentStatus, AgentStep, PlanItem } from './agents.types';

export interface AgentTraceMessage {
    readonly role: AgentMessage['role'];
    readonly text: string;
    readonly from?: string;
    readonly hidden?: boolean;
    /** `server/tool` and its state, for tool cards. */
    readonly tool?: string;
    readonly toolState?: string;
    /** The tool call's arguments as JSON (command, cwd, path). */
    readonly toolArgs?: string;
}

/** IDEA-282: a read-only snapshot of one chat, for headless runs that print the steps and the live reply. */
export interface AgentTrace {
    readonly id: string;
    readonly title: string;
    readonly status: AgentStatus;
    readonly running: boolean;
    readonly model: string;
    readonly plan: readonly PlanItem[];
    readonly steps: readonly AgentStep[];
    readonly messages: readonly AgentTraceMessage[];
    readonly ask?: string;
    readonly approval?: string;
}
