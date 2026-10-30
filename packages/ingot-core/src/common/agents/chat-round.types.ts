import type { REACTION_KINDS } from './chat-round.consts';

export type ReactionKind = (typeof REACTION_KINDS)[number];

export type TabRunState = 'running' | 'waiting' | 'done' | 'idle';

export interface ThoughtStamp {
    readonly thoughtStarted?: number;
    readonly thoughtMs?: number;
}

export interface TurnFile {
    readonly path: string;
    readonly added: number;
    readonly removed: number;
}

export interface TurnCommand {
    readonly command: string;
    readonly messageIndex: number;
}

export interface TurnCommit {
    readonly subject: string;
    readonly messageIndex: number;
}

export interface TurnActivity {
    readonly files: readonly TurnFile[];
    readonly commands: readonly TurnCommand[];
    readonly commits: readonly TurnCommit[];
}

export interface EditConflict {
    readonly path: string;
    readonly ids: readonly string[];
}
