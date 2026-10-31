/** IDEA-287: where a custom subagent file was found. */
export type SubagentScope = 'project' | 'user';

/** A custom subagent (`.ingot/agents/*.md`, `.cursor/agents/*.md`, …) the `ingot/task` tool can start by name. */
export interface CustomSubagent {
    readonly name: string;
    readonly description: string;
    /** Model id without Cursor's `[effort=…]` options; undefined means the lead chat's model (`inherit`). */
    readonly model?: string;
    /** Only reads: no edits, commands or writing tools. */
    readonly readonly: boolean;
    /** Cursor's `is_background`; Ingot still waits for it (see the report), the flag is kept for the listing. */
    readonly background: boolean;
    /** The file body: the subagent's instructions. */
    readonly prompt: string;
    /** Where it came from, for the listing (`.cursor/agents/reviewer.md`, `~/.claude/agents/x.md`). */
    readonly path: string;
    readonly scope: SubagentScope;
}
