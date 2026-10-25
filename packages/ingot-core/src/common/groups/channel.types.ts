export type GroupMessageKind = 'ask' | 'notify' | 'reply' | 'edit';
export type EditStatus = 'pending' | 'approved' | 'denied' | 'failed';

export interface GroupParticipant {
    /** Project root URI. */
    readonly project: string;
    readonly projectName: string;
    readonly agent?: string;
}

export interface GroupEditRequest {
    /** Path relative to the target project root. */
    readonly file: string;
    /** Text appended to the file once the user approves. */
    readonly text: string;
    status: EditStatus;
}

export interface GroupMessage {
    readonly id: string;
    readonly kind: GroupMessageKind;
    readonly from: GroupParticipant;
    readonly to: GroupParticipant;
    readonly text: string;
    readonly at: number;
    readonly replyTo?: string;
    readonly edit?: GroupEditRequest;
}

/** A group channel command typed in an agent composer (or issued by the agent runtime as a tool call). */
export type GroupCommand =
    | { readonly kind: 'ask' | 'notify'; readonly project: string; readonly text: string }
    | { readonly kind: 'reply'; readonly text: string }
    | { readonly kind: 'edit'; readonly project: string; readonly file: string; readonly text: string };
