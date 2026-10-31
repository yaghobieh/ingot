/** IDEA-287: a team rule as an admin edits it (Cursor's dashboard Team Rules). */
export interface TeamRuleDraft {
    readonly name: string;
    readonly body: string;
    readonly description?: string;
    /** Comma-separated globs; empty means every conversation. */
    readonly globs?: string;
    readonly alwaysApply?: boolean;
    /** Members cannot turn it off. */
    readonly enforced?: boolean;
    /** Unchecked keeps it as a draft that members do not get. */
    readonly enabled: boolean;
}

/** Where team rules are kept: the account server, or this machine while the server has no team rules API. */
export type TeamRulesStore = 'server' | 'local';

export interface TeamRulesState {
    readonly rules: readonly TeamRuleDraft[];
    readonly store: TeamRulesStore;
    readonly error?: string;
}

/** `team-rules.local.json` in the user config folder. */
export interface TeamRulesStubFile {
    readonly version: number;
    readonly todo: string;
    readonly rules: readonly TeamRuleDraft[];
}

export interface TeamRulesResponse {
    readonly status: number;
    readonly body: Record<string, unknown>;
}
