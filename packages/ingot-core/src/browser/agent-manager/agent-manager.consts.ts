/** IDEA-291: the Agent Manager tool window. */
export const AGENT_MANAGER_WIDGET_ID = 'ingot-agent-manager';
export const AGENT_MANAGER_WIDGET_LABEL = 'Agent Manager';
export const AGENT_MANAGER_COMMANDS = {
    toggle: { id: 'ingot.agentManager.toggle', label: 'Agent Manager', category: 'Agents' },
    nextApproval: { id: 'ingot.agentManager.nextApproval', label: 'Jump to Next Agent Approval', category: 'Agents' }
} as const;
export const ROW_INDENT_PX = 16;
