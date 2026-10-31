import type { AgentSession } from './agents.types';

/** Work the store does outside a model round or tool call, named on the live status line. */
export type LivePhase = 'checking-plan' | 'wrapping-up';

export type LiveStatusKind =
    | 'waiting' | 'typing' | 'reading' | 'exploring' | 'searching' | 'web' | 'testing' | 'checks' | 'building' | 'installing'
    | 'serving' | 'running' | 'editing' | 'deleting' | 'git' | 'browser' | 'subagents' | 'checking-plan' | 'wrapping-up' | 'working';

/** The status line at the end of a running chat. `waiting` (no token yet) also shows the typing dots. */
export interface LiveStatus {
    readonly kind: LiveStatusKind;
    readonly label: string;
}

export interface LiveStatusInput {
    readonly session: Pick<AgentSession, 'status' | 'activeFile' | 'ask' | 'messages'>;
    /** The model loop is running for this chat. */
    readonly running: boolean;
    /** A model reply is streaming right now. */
    readonly streaming: boolean;
    readonly phase?: LivePhase;
}

/** Shell command kinds that read better as a plain sentence than as the command itself. */
export type CommandKind = Extract<LiveStatusKind, 'testing' | 'checks' | 'building' | 'installing' | 'serving'>;
