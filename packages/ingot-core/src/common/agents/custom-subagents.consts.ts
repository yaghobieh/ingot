/** IDEA-287: custom subagents as Cursor reads them; on a name clash project beats user and `.ingot` / `.cursor` beat `.claude` / `.codex`. */
export const SUBAGENT_FILE_EXTENSIONS = ['.md', '.mdc'] as const;
/** Lowest priority first, per scope. */
export const SUBAGENT_OTHER_DIRS = ['.codex/agents', '.claude/agents'] as const;
export const SUBAGENT_CURSOR_DIR = '.cursor/agents';
export const SUBAGENT_INGOT_DIR = '.ingot/agents';
/** The model value that means "the lead chat's model". */
export const INHERIT_MODEL = 'inherit';
/** `ingot/task` argument naming the subagent (Cursor's name), and a short alias. */
export const SUBAGENT_TYPE_ARGS = ['subagent_type', 'agent'] as const;
export const SUBAGENT_NAME_PATTERN = /^[\w.-]+$/;
export const MAX_SUBAGENT_DESCRIPTION = 200;

export const SUBAGENT_TEXT = {
    header: 'Custom subagents. Start one with ingot/task and "subagent_type": "<name>"; it follows its own instructions:',
    readonly: 'read-only',
    instructions: 'Your instructions as the subagent',
    unknown: 'Unknown subagent',
    available: 'Available',
    none: 'none',
    readonlyBlocked: 'is a read-only subagent'
} as const;
