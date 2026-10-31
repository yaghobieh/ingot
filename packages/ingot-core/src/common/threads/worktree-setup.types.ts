/** IDEA-287: one `setup-worktree*` value of worktrees.json: commands run in order, or a script path relative to the file. */
export type WorktreeSetupEntry = readonly string[] | string;

export interface WorktreeSetupConfig {
    readonly unix?: WorktreeSetupEntry;
    readonly windows?: WorktreeSetupEntry;
    readonly any?: WorktreeSetupEntry;
}

/** What to run for one platform: shell command lines, or one script (absolute path). */
export type WorktreeSetupPlan =
    | { readonly kind: 'commands'; readonly commands: readonly string[] }
    | { readonly kind: 'script'; readonly script: string };

/** What the setup did, for the toast and the subagent's chat. */
export interface WorktreeSetupResult {
    /** The worktrees.json that was used, relative to its folder (`.ingot/worktrees.json`). */
    readonly source: string;
    readonly ran: number;
    readonly ok: boolean;
    readonly output: string;
    readonly error?: string;
}
