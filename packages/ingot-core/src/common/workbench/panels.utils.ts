import type { PanelBar, PanelEntry } from './panels.types';
import { PANEL_BAR_ORDER } from './panels.consts';

/** Whether a widget id belongs to a panel (exact id, or prefix for multi-widget panels such as Terminal). */
export const panelOwnsWidget = (panel: PanelEntry, widgetId: string): boolean =>
    panel.prefix ? widgetId.startsWith(panel.widgetId) : widgetId === panel.widgetId;

/** Panels ordered for the menu: the bar that was right-clicked first, then the others. */
export const panelsForBar = (panels: readonly PanelEntry[], bar: PanelBar): PanelEntry[] => {
    const order = [bar, ...PANEL_BAR_ORDER.filter(b => b !== bar)];
    return [...panels].sort((a, b) => order.indexOf(a.bar) - order.indexOf(b.bar));
};

export const panelCommandId = (panel: PanelEntry): string => `ingot.panels.toggle.${panel.id}`;
