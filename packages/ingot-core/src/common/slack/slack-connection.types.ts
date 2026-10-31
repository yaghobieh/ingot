export type SlackConnectionState = 'disconnected' | 'off' | 'connecting' | 'connected' | 'needs-token' | 'error';

/** What the Slack card shows. */
export interface SlackConnectionView {
    readonly state: SlackConnectionState;
    readonly summary: string;
    /** Tools the agent can use (0 unless connected). */
    readonly tools: number;
}
