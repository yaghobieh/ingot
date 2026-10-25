export type PanelBar = 'left' | 'bottom' | 'right';

/** A tool window that the stripe and tab bar right-click menus can show or hide (IDEA-119). */
export interface PanelEntry {
    readonly id: string;
    readonly label: string;
    /** Widget id, or the id prefix when a panel has several widgets (Terminal 1, Terminal 2, …). */
    readonly widgetId: string;
    readonly prefix?: boolean;
    /** Command that opens (reveals) the panel. */
    readonly open: string;
    /** Where the panel lives by default; the menu groups panels by it. */
    readonly bar: PanelBar;
}
