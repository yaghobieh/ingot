import type { AgentMode } from './agents.types';

export interface AgentModeInfo {
    readonly id: AgentMode;
    readonly label: string;
    /** Codicon name. */
    readonly icon: string;
    /** Accent color (CSS variable with a fallback) for the pill and the menu. */
    readonly color: string;
    readonly description: string;
    /** May propose file edits (they still go through the inline review). */
    readonly canEdit: boolean;
    /** May call MCP tools (tools can write or run commands). */
    readonly canUseTools: boolean;
    /** Shows a Beta pill next to the label. */
    readonly beta?: boolean;
}

/** The chat modes (IDEA-77, Deep research IDEA-314). The mode decides tool permissions and the system prompt. */
export const AGENT_MODE_INFO: readonly AgentModeInfo[] = [
    { id: 'agent', label: 'Agent', icon: 'sparkle', color: 'var(--ingot-mode-agent, #6E8BFF)', description: 'Plans, edits files and runs tools. Every edit goes through review.', canEdit: true, canUseTools: true },
    { id: 'multi', label: 'Multi-agent', icon: 'organization', color: 'var(--ingot-mode-multi, #B57BFF)', description: 'Splits the task into subtasks and runs parallel agents in their own tabs.', canEdit: true, canUseTools: true },
    { id: 'ask', label: 'Ask', icon: 'comment-discussion', color: 'var(--ingot-mode-ask, #3FB950)', description: 'Read-only answers about your code. No edits, no tools.', canEdit: false, canUseTools: false },
    { id: 'plan', label: 'Plan', icon: 'checklist', color: 'var(--ingot-mode-plan, #E3B341)', description: 'Writes a step plan you can edit, then Build runs it in Agent mode.', canEdit: false, canUseTools: false },
    { id: 'debug', label: 'Debug', icon: 'debug-alt', color: 'var(--ingot-mode-debug, #F85149)', description: 'Reads terminal output and stack traces, finds the cause and proposes a fix.', canEdit: true, canUseTools: true },
    { id: 'research', label: 'Deep research', icon: 'telescope', color: 'var(--ingot-mode-research, var(--ingot-info))', description: 'Searches the web, Reddit, Hacker News, GitHub and Stack Exchange, reads 15-40 pages and answers with cited sources.', canEdit: false, canUseTools: false, beta: true }
];

export const AGENT_MODE_IDS: readonly AgentMode[] = AGENT_MODE_INFO.map(m => m.id);

export const modeInfo = (mode: AgentMode): AgentModeInfo => AGENT_MODE_INFO.find(m => m.id === mode) ?? AGENT_MODE_INFO[0];

/** Next mode in the ⌘. cycle. */
export const nextMode = (mode: AgentMode, step = 1): AgentMode => {
    const index = AGENT_MODE_IDS.indexOf(mode);
    return AGENT_MODE_IDS[((index < 0 ? 0 : index) + step + AGENT_MODE_IDS.length) % AGENT_MODE_IDS.length];
};

export const isAgentMode = (value: unknown): value is AgentMode => typeof value === 'string' && (AGENT_MODE_IDS as readonly string[]).includes(value);

/** Most subtasks a Multi-agent run starts in parallel. */
export const MAX_SUB_AGENTS = 4;
export const BUILD_PROMPT = 'Implement the plan above, step by step.';
export const TERMINAL_CONTEXT_LINES = 120;
