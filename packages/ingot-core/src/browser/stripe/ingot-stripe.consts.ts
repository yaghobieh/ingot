import { PORTS_TOGGLE_COMMAND } from '../ports/ingot-ports.consts';

export interface StripeButton {
    readonly id: string;
    readonly icon: string;
    readonly title: string;
    readonly command: string;
    /** Prefix of the widget id this button shows, used for the selected state. */
    readonly widgetPrefix: string;
}

/** JetBrains New UI bottom-left stripe group: tool windows that dock to the bottom. */
export const BOTTOM_STRIPE: readonly StripeButton[] = [
    { id: 'terminal', icon: 'terminal', title: 'Terminal (⌥F12)', command: 'workbench.action.terminal.toggleTerminal', widgetPrefix: 'terminal-' },
    { id: 'run', icon: 'run', title: 'Run (⌘4)', command: 'output:toggle', widgetPrefix: 'outputView' },
    { id: 'problems', icon: 'problems', title: 'Problems (⌘6)', command: 'problemsView:toggle', widgetPrefix: 'problems' },
    { id: 'ports', icon: 'ports', title: 'Services / Ports', command: PORTS_TOGGLE_COMMAND.id, widgetPrefix: 'ingot-ports' }
];

export const STRIPE_WIDGET_ID = 'ingot-stripe-bottom';
