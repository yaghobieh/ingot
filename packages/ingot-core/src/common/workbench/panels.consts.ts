import type { PanelBar, PanelEntry } from './panels.types';

/** Every tool window, grouped by its default bar (IDEA-119). */
export const PANELS: readonly PanelEntry[] = [
    { id: 'project', label: 'Project', widgetId: 'explorer-view-container', open: 'fileNavigator:toggle', bar: 'left' },
    { id: 'search', label: 'Search', widgetId: 'search-view-container', open: 'search-in-workspace.toggle', bar: 'left' },
    { id: 'git', label: 'Git', widgetId: 'scm-view-container', open: 'scmView:toggle', bar: 'left' },
    { id: 'commit', label: 'Commit', widgetId: 'ingot-local-changes', open: 'ingot.commit.toggleView', bar: 'left' },
    { id: 'outline', label: 'Structure', widgetId: 'outline-view', open: 'outlineView:toggle', bar: 'left' },
    { id: 'debug', label: 'Run and Debug', widgetId: 'debug', open: 'debug:toggle', bar: 'left' },
    { id: 'extensions', label: 'Extensions', widgetId: 'vsx-extensions-view-container', open: 'vsxExtensions.toggle', bar: 'left' },
    { id: 'terminal', label: 'Terminal', widgetId: 'terminal-', prefix: true, open: 'workbench.action.terminal.toggleTerminal', bar: 'bottom' },
    { id: 'problems', label: 'Problems', widgetId: 'problems', open: 'problemsView:toggle', bar: 'bottom' },
    { id: 'output', label: 'Output', widgetId: 'outputView', open: 'output:toggle', bar: 'bottom' },
    { id: 'ports', label: 'Ports', widgetId: 'ingot-ports', open: 'ingot.ports.toggle', bar: 'bottom' },
    { id: 'agents', label: 'Agents (Chat)', widgetId: 'ingot-agents', open: 'ingot.agents.toggle', bar: 'right' },
    { id: 'database', label: 'Database', widgetId: 'ingot-database', open: 'ingot.database.toggle', bar: 'right' },
    { id: 'mcp', label: 'MCP Servers', widgetId: 'ingot-mcp', open: 'ingot.mcp.toggle', bar: 'right' },
    { id: 'services', label: 'Services', widgetId: 'ingot-services', open: 'ingot.services.toggle', bar: 'right' },
    { id: 'history', label: 'Git History', widgetId: 'ingot-git-log', open: 'ingot.git.log', bar: 'right' }
];

export const PANEL_BAR_ORDER: readonly PanelBar[] = ['left', 'bottom', 'right'];
