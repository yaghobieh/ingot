import type { Command } from '@theia/core/lib/common/command';

/** IDEA-127: move panels between areas, Reset Layout, divider double-click fit. */
export type MoveArea = 'left' | 'right' | 'bottom';

export const LAYOUT_CUSTOM_COMMANDS = {
    moveLeft: { id: 'ingot.layout.moveToLeft', label: 'Move to Left' },
    moveRight: { id: 'ingot.layout.moveToRight', label: 'Move to Right' },
    moveBottom: { id: 'ingot.layout.moveToBottom', label: 'Move to Bottom' },
    reset: { id: 'ingot.layout.reset', label: 'Reset Layout', category: 'View' }
} as const satisfies Record<string, Command>;

export const MOVE_TARGETS: readonly { readonly area: MoveArea; readonly command: Command }[] = [
    { area: 'left', command: LAYOUT_CUSTOM_COMMANDS.moveLeft },
    { area: 'right', command: LAYOUT_CUSTOM_COMMANDS.moveRight },
    { area: 'bottom', command: LAYOUT_CUSTOM_COMMANDS.moveBottom }
];

/** Theia's own reset (clears the stored per-workspace layout and reloads). */
export const RESET_WORKBENCH_LAYOUT = 'reset.layout';
export const MOVE_SUBMENU_LABEL = 'Move to';
export const MOVE_GROUP = '8_ingot_move';
/** Gear menu group between Tools and App (lexical order: 3_tools < 3z_layout < 4_app). */
export const GEAR_LAYOUT_GROUP = '3z_layout';
export const VIEW_LAYOUT_GROUP = '9_ingot_layout';

/** Tab elements are `shell-tab-<widget id>`; right stripe buttons are `ingot-rs-<item id>`. */
export const TAB_ID_PREFIX = 'shell-tab-';
export const RIGHT_STRIPE_BUTTON_PREFIX = 'ingot-rs-';

export const SPLIT_HANDLE_SELECTOR = '.lm-SplitPanel-handle';
export const AREA_PANEL_IDS: Readonly<Record<MoveArea, string>> = {
    left: 'theia-left-content-panel',
    right: 'theia-right-content-panel',
    bottom: 'theia-bottom-content-panel'
};
/** How far (px) a divider may sit from a panel edge and still belong to it. */
export const HANDLE_TOLERANCE_PX = 10;
/** A dblclick counts for the divider pressed this recently (ms). */
export const DOUBLE_CLICK_MS = 800;
/** Upper bound of elements measured when fitting a panel to its content. */
export const FIT_MEASURE_LIMIT = 4000;

export const RIGHT_STRIPE_ORDER_KEY = 'ingot.rightStripe.order';
