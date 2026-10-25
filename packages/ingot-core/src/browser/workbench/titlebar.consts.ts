import type { Command } from '@theia/core/lib/common/command';

/** Title bar right-hand actions (IDEA-118), per docs/design/titlebar-right-reference.png. */
export const TITLEBAR_COMMANDS = {
    agentsWindow: { id: 'ingot.agentsWindow.open', label: 'Open Agents Window', category: 'View' }
} as const satisfies Record<string, Command>;

/** Theia's own toggle for the bottom panel. */
export const TOGGLE_BOTTOM_PANEL_COMMAND = 'core.toggle.bottom.panel';

export const TITLEBAR_TEXT = {
    bottomPanel: 'Toggle Bottom Panel (⌘J)',
    chat: 'Toggle Chat',
    settings: 'Manage: Settings, Theme, Extensions, MCP…',
    agentsWindow: 'Agents Window',
    agentsWindowTitle: 'Open the agents in their own window'
} as const;

export const AGENTS_WINDOW_BODY_CLASS = 'ingot-agents-window';
export const AGENTS_WINDOW_TITLE = 'Agents — Ingot';
/** Side panels animate open and closed; re-read their state once that has settled. */
export const TITLEBAR_REFRESH_DELAYS_MS = [60, 250, 600] as const;
