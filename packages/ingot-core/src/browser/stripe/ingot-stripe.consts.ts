import { PORTS_TOGGLE_COMMAND } from '../ports/ingot-ports.consts';
import { AGENTS_WIDGET_ID } from '../agents/agents.consts';
import { LOCAL_CHANGES_WIDGET_ID } from '../commit/commit.consts';
import { THREADS_WIDGET_ID } from '../threads/threads.consts';

export interface StripeButton {
    readonly id: string;
    readonly icon: string;
    readonly title: string;
    readonly command: string;
    /** Prefix of the widget id this button shows, used for the selected state. */
    readonly widgetPrefix: string;
}

/**
 * Bottom-panel tool windows shown in the thin left stripe, under the side bar tabs (Project, Search, Git).
 * Terminal, Run, Problems and Ports stay in the main toolbar, a shortcut or a menu entry away.
 */
export const BOTTOM_STRIPE: readonly StripeButton[] = [];

/** Side bar tool windows hidden from the stripe; still reachable from menus and shortcuts. */
export const HIDDEN_SIDE_TABS = ['debug', 'vsx-extensions-view-container', 'test-view-container'] as const;

/** Prefix of the view container id for an extension's `viewsContainers.activitybar` entry. */
const PLUGIN_CONTAINER = 'plugin-view-container:workbench.view.extension.';

/**
 * Side bar tabs drawn with an Ingot icon (`assets/icons/<icon>.svg`): view container id, prefix-matched by
 * `[id^='shell-tab-<id>']` in shell.css, which must map exactly these. Any other tab keeps its own codicon or plugin icon.
 */
export const SIDE_TAB_ICONS: Readonly<Record<string, string>> = {
    'explorer-view-container': 'project',
    'search-view-container': 'search',
    'scm-view-container': 'commit',
    'debug': 'debug',
    'vsx-extensions-view-container': 'plugins',
    'outline-view': 'structure',
    'test-view-container': 'test',
    [AGENTS_WIDGET_ID]: 'rex',
    [LOCAL_CHANGES_WIDGET_ID]: 'changes',
    [THREADS_WIDGET_ID]: 'threads',
    [`${PLUGIN_CONTAINER}gitlens`]: 'lens',
    [`${PLUGIN_CONTAINER}gitlensInspect`]: 'inspect',
    [`${PLUGIN_CONTAINER}gitlensPatch`]: 'patch',
    [`${PLUGIN_CONTAINER}tokenforge`]: 'forge',
    [`${PLUGIN_CONTAINER}pgObjectExplorer`]: 'database'
};

export { PORTS_TOGGLE_COMMAND };

export const STRIPE_WIDGET_ID = 'ingot-stripe-bottom';
