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
    | { readonly id: string; readonly icon: string; readonly title: string; readonly kind: 'panel'; readonly widgetId: string; readonly command: string; readonly mark?: typeof REX_STRIPE_MARK }
    | { readonly id: string; readonly icon: string; readonly title: string; readonly kind: 'command'; readonly command: string }
    | { readonly id: string; readonly icon: string; readonly title: string; readonly kind: 'notifications' };

/** Stripe items drawn with the Rex glyph instead of a codicon: the agent identity. */
export const REX_STRIPE_MARK = 'rex';
export const RIGHT_STRIPE_MARK_SIZE = 16;

/** The right-edge tool window stripe, top to bottom (IDEA-61). Icons are codicons, except the agent's Rex mark. */
export const RIGHT_STRIPE_TOP: readonly RightStripeItem[] = [
    { id: 'notifications', icon: 'bell', title: 'Notifications', kind: 'notifications' },
    { id: 'agents', icon: 'sparkle', title: 'Agents / AI Chat', kind: 'panel', widgetId: AGENTS_WIDGET_ID, command: AGENT_COMMANDS.toggle.id, mark: REX_STRIPE_MARK },
    { id: 'database', icon: 'database', title: 'Database', kind: 'panel', widgetId: DATABASE_WIDGET_ID, command: TOOL_WINDOW_COMMANDS.database.id },
    { id: 'mcp', icon: 'plug', title: 'MCP Servers', kind: 'panel', widgetId: MCP_WIDGET_ID, command: TOOL_WINDOW_COMMANDS.mcp.id },
    { id: 'services', icon: 'server-process', title: 'Services', kind: 'panel', widgetId: SERVICES_WIDGET_ID, command: TOOL_WINDOW_COMMANDS.services.id },
    { id: 'history', icon: 'history', title: 'Git History', kind: 'panel', widgetId: GIT_LOG_WIDGET_ID, command: 'ingot.git.log' }
];

export const RIGHT_STRIPE_BOTTOM: readonly RightStripeItem[] = [
    { id: 'theme', icon: 'color-mode', title: 'Theme: Light, Dark or System', kind: 'command', command: 'ingot.appearance.pick' }
];

/** MCP form copy: secrets go to Ingot's local key file, never the OS keychain or mcp.json. */
export const MCP_SECRET_TEXT = {
    fieldNote: " · stored in Ingot's local key file (~/.ingot/keystore.json)",
    authNote: "Secrets are stored in Ingot's local key file (~/.ingot/keystore.json), never in project or config files.",
    formHint: "Values marked Secret are saved in Ingot's local key file (~/.ingot/keystore.json); mcp.json only gets a placeholder.",
    secretTitle: "Store the value in Ingot's local key file (~/.ingot/keystore.json)",
    secretPlaceholder: 'stored in key file',
    detailNote: '(local key file)'
} as const;
