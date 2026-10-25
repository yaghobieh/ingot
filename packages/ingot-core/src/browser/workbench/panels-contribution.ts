import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { ContextMenuRenderer } from '@theia/core/lib/browser/context-menu-renderer';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { CommandRegistry, type CommandContribution } from '@theia/core/lib/common/command';
import type { MenuContribution, MenuModelRegistry } from '@theia/core/lib/common/menu';
import type { Widget } from '@theia/core/lib/browser/widgets/widget';
import { SHELL_TABBAR_CONTEXT_MENU } from '@theia/core/lib/browser/shell/tab-bars';
import { LAYOUT_COMMANDS } from '../layout/layout.browser-consts';
import { PANEL_BAR_ORDER, PANELS } from '../../common/workbench/panels.consts';
import type { PanelBar, PanelEntry } from '../../common/workbench/panels.types';
import { panelCommandId, panelOwnsWidget } from '../../common/workbench/panels.utils';
import { PANEL_BAR_SELECTORS, PANEL_TAB_SELECTOR, PANELS_LAYOUT_GROUP, PANELS_SUBMENU_LABEL, panelsMenu } from './panels.consts';

/**
 * Panel toggles (IDEA-119): right-click the left stripe, the bottom panel's tab bar or the right stripe to get every
 * tool window with a ✓ when it is showing; clicking one shows or hides it. Chat right / bottom sits at the end.
 */
@injectable()
export class IngotPanelsContribution implements CommandContribution, MenuContribution, FrontendApplicationContribution {

    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(ContextMenuRenderer) protected readonly contextMenu: ContextMenuRenderer;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;

    protected readonly onContextMenu = (event: MouseEvent): void => {
        const target = event.target as HTMLElement | null;
        const bar = target && PANEL_BAR_ORDER.find(b => !!target.closest(PANEL_BAR_SELECTORS[b]));
        // A bottom tab keeps its own menu (Close, Rename, …) with a Tool Windows submenu; the bar's empty space lists panels.
        if (!bar || (bar === 'bottom' && target.closest(PANEL_TAB_SELECTOR))) {
            return;
        }
        event.preventDefault();
        event.stopPropagation();
        this.contextMenu.render({ menuPath: panelsMenu(bar), anchor: { x: event.clientX, y: event.clientY }, context: target, includeAnchorArg: false });
    };

    onStart(): void {
        // Capture phase: runs before the tab bars' own context menus.
        document.addEventListener('contextmenu', this.onContextMenu, true);
    }

    onStop(): void {
        document.removeEventListener('contextmenu', this.onContextMenu, true);
    }

    protected widgetsOf(panel: PanelEntry): Widget[] {
        return this.shell.widgets.filter(w => panelOwnsWidget(panel, w.id));
    }

    /** Showing: one of its widgets is visible in an expanded area (or in the editor area). */
    isShowing(panel: PanelEntry): boolean {
        return this.widgetsOf(panel).some(w => {
            const area = this.shell.getAreaFor(w);
            return w.isVisible && (area === 'main' || (!!area && area !== 'top' && this.shell.isExpanded(area)));
        });
    }

    async toggle(panel: PanelEntry): Promise<void> {
        if (!this.isShowing(panel)) {
            await this.commands.executeCommand(panel.open);
            const [widget] = this.widgetsOf(panel);
            if (widget && !widget.isVisible) {
                await this.shell.activateWidget(widget.id);
            }
            return;
        }
        for (const widget of this.widgetsOf(panel).filter(w => w.isVisible)) {
            const area = this.shell.getAreaFor(widget);
            if (area === 'left' || area === 'right' || area === 'bottom') {
                await this.shell.collapsePanel(area);
            } else {
                widget.close();
            }
        }
    }

    registerCommands(registry: CommandRegistry): void {
        for (const panel of PANELS) {
            registry.registerCommand({ id: panelCommandId(panel), label: panel.label }, {
                execute: () => this.toggle(panel),
                isToggled: () => this.isShowing(panel),
                isVisible: () => !!registry.getCommand(panel.open)
            });
        }
    }

    registerMenus(menus: MenuModelRegistry): void {
        for (const bar of PANEL_BAR_ORDER) {
            const order: PanelBar[] = [bar, ...PANEL_BAR_ORDER.filter(b => b !== bar)];
            PANELS.forEach((panel, index) => {
                const group = `${order.indexOf(panel.bar)}_${panel.bar}`;
                menus.registerMenuAction([...panelsMenu(bar), group], { commandId: panelCommandId(panel), label: panel.label, order: String(index).padStart(2, '0') });
            });
            menus.registerMenuAction([...panelsMenu(bar), PANELS_LAYOUT_GROUP], { commandId: LAYOUT_COMMANDS.chatRight.id, order: 'a' });
            menus.registerMenuAction([...panelsMenu(bar), PANELS_LAYOUT_GROUP], { commandId: LAYOUT_COMMANDS.chatBottom.id, order: 'b' });
        }
        const submenu = [...SHELL_TABBAR_CONTEXT_MENU, '9_ingot_panels', 'panels'];
        menus.registerSubmenu(submenu, PANELS_SUBMENU_LABEL);
        PANELS.forEach((panel, index) => menus.registerMenuAction([...submenu, `${PANEL_BAR_ORDER.indexOf(panel.bar)}_${panel.bar}`],
            { commandId: panelCommandId(panel), label: panel.label, order: String(index).padStart(2, '0') }));
    }
}
