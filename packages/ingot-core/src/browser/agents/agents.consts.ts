export const AGENTS_WIDGET_ID = 'ingot-agents';
export const AGENTS_WIDGET_LABEL = 'Agents';

export const AGENT_COMMANDS = {
    toggle: { id: 'ingot.agents.toggle', label: 'Agents', category: 'View' },
    newAgent: { id: 'ingot.agents.new', label: 'New Chat', category: 'Agents' },
    cycleMode: { id: 'ingot.agents.cycleMode', label: 'Cycle Chat Mode', category: 'Agents' },
    history: { id: 'ingot.agents.history', label: 'Chat History', category: 'Agents' },
    memories: { id: 'ingot.agents.memories', label: 'Manage Memories', category: 'Agents' },
    addSelectionToChat: { id: 'ingot.agents.addSelectionToChat', label: 'Add Selection to Agent Chat', category: 'Agents' },
    acceptEdit: { id: 'ingot.agents.acceptEdit', label: 'Accept Agent Edit', category: 'Agents' },
    rejectEdit: { id: 'ingot.agents.rejectEdit', label: 'Reject Agent Edit', category: 'Agents' },
    demoEdit: { id: 'ingot.agents.demoEdit', label: 'Try Agent Edit Review (demo)', category: 'Agents' }
} as const;

/** Reference design shortcuts: real Ctrl on every platform. */
export const ACCEPT_EDIT_KEY = 'ctrl+y';
export const REJECT_EDIT_KEY = 'ctrl+n';
export const DEMO_MARKER = 'reviewed by Ingot agent (demo)';


/** Context key: focus is inside the Agents tool window. */
export const AGENTS_FOCUS_KEY = 'ingotAgentsFocus';
