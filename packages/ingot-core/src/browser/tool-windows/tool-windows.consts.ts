import type { Command } from '@theia/core/lib/common/command';
import { AGENTS_WIDGET_ID, AGENT_COMMANDS } from '../agents/agents.consts';
import { GIT_LOG_WIDGET_ID } from '../git/git.browser-consts';

export const DATABASE_WIDGET_ID = 'ingot-database';
export const MCP_WIDGET_ID = 'ingot-mcp';
export const SERVICES_WIDGET_ID = 'ingot-services';
export const RIGHT_STRIPE_ID = 'ingot-right-stripe';

export const TOOL_WINDOW_COMMANDS = {
    database: { id: 'ingot.database.toggle', label: 'Database', category: 'View' },
    mcp: { id: 'ingot.mcp.toggle', label: 'Rules & MCP', category: 'View' },
    services: { id: 'ingot.services.toggle', label: 'Services', category: 'View' },
    databaseRefresh: { id: 'ingot.database.refresh', label: 'Refresh Data Sources', category: 'Database' }
} as const satisfies Record<string, Command>;

export type RightStripeItem =
    | { readonly id: string; readonly icon: string; readonly title: string; readonly kind: 'panel'; readonly widgetId: string; readonly command: string }
    | { readonly id: string; readonly icon: string; readonly title: string; readonly kind: 'command'; readonly command: string }
    | { readonly id: string; readonly icon: string; readonly title: string; readonly kind: 'notifications' };

/** The right-edge tool window stripe, top to bottom (IDEA-61). Icons are codicons. */
export const RIGHT_STRIPE_TOP: readonly RightStripeItem[] = [
    { id: 'settings', icon: 'settings-gear', title: 'Settings (Ctrl+Alt+S)', kind: 'command', command: 'ingot.settings.open' },
    { id: 'notifications', icon: 'bell', title: 'Notifications', kind: 'notifications' },
    { id: 'agents', icon: 'sparkle', title: 'Agents / AI Chat', kind: 'panel', widgetId: AGENTS_WIDGET_ID, command: AGENT_COMMANDS.toggle.id },
    { id: 'database', icon: 'database', title: 'Database', kind: 'panel', widgetId: DATABASE_WIDGET_ID, command: TOOL_WINDOW_COMMANDS.database.id },
    { id: 'mcp', icon: 'plug', title: 'MCP Servers', kind: 'panel', widgetId: MCP_WIDGET_ID, command: TOOL_WINDOW_COMMANDS.mcp.id },
    { id: 'services', icon: 'server-process', title: 'Services', kind: 'panel', widgetId: SERVICES_WIDGET_ID, command: TOOL_WINDOW_COMMANDS.services.id },
    { id: 'history', icon: 'history', title: 'Git History', kind: 'panel', widgetId: GIT_LOG_WIDGET_ID, command: 'ingot.git.log' }
];

export const RIGHT_STRIPE_BOTTOM: readonly RightStripeItem[] = [
    { id: 'theme', icon: 'color-mode', title: 'Theme: Light, Dark or System', kind: 'command', command: 'ingot.appearance.pick' }
];
