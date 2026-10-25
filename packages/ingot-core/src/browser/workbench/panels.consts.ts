import type { PanelBar } from '../../common/workbench/panels.types';

/** Right-click menu of each bar (IDEA-119); the clicked bar's panels come first. */
export const panelsMenu = (bar: PanelBar): string[] => [`ingot-panels-${bar}`];
export const PANELS_LAYOUT_GROUP = '9_layout';

/** Where a right-click opens the panels menu, per bar. */
export const PANEL_BAR_SELECTORS: Readonly<Record<PanelBar, string>> = {
    left: '#theia-left-content-panel > .lm-TabBar, .theia-app-left, #ingot-stripe-bottom',
    bottom: '#theia-bottom-content-panel > .lm-TabBar, #theia-bottom-content-panel .theia-app-bottom',
    right: '#ingot-right-stripe, .ingot-right-stripe'
};
export const PANEL_TAB_SELECTOR = '.lm-TabBar-tab';
export const PANELS_SUBMENU_LABEL = 'Tool Windows';
