import { PORTS_TOGGLE_COMMAND } from '../ports/ingot-ports.consts';

export interface StripeButton {
    readonly id: string;
    readonly icon: string;
    readonly title: string;
    readonly command: string;
    /** Prefix of the widget id this button shows, used for the selected state. */
    readonly widgetPrefix: string;
}

/**
 * The thin left stripe shows four tool windows (Project, Search, Git from the side bar, plus Terminal).
 * Run, Problems and Ports stay one shortcut or menu entry away.
 */
export const BOTTOM_STRIPE: readonly StripeButton[] = [
    { id: 'terminal', icon: 'terminal', title: 'Terminal (⌥F12)', command: 'workbench.action.terminal.toggleTerminal', widgetPrefix: 'terminal-' }
];

/** Side bar tool windows hidden from the stripe; still reachable from menus and shortcuts. */
export const HIDDEN_SIDE_TABS = ['debug', 'vsx-extensions-view-container', 'test-view-container'] as const;

export { PORTS_TOGGLE_COMMAND };

export const STRIPE_WIDGET_ID = 'ingot-stripe-bottom';
