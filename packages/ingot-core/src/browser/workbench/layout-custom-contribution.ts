import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { CommonMenus } from '@theia/core/lib/browser/common-menus';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { SHELL_TABBAR_CONTEXT_MENU } from '@theia/core/lib/browser/shell/tab-bars';
import type { Widget } from '@theia/core/lib/browser/widgets/widget';
import { CommandRegistry, type CommandContribution } from '@theia/core/lib/common/command';
import type { MenuContribution, MenuModelRegistry } from '@theia/core/lib/common/menu';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { PANEL_BAR_ORDER } from '../../common/workbench/panels.consts';
import { toggleFit, workspaceKey, type FitState } from '../../common/workbench/layout-custom.utils';
import { RIGHT_STRIPE_TOP } from '../tool-windows/tool-windows.consts';
import { GEAR_MENU } from './gear-menu.consts';
import { panelsMenu } from './panels.consts';
import {
    AREA_PANEL_IDS, DOUBLE_CLICK_MS, FIT_MEASURE_LIMIT, GEAR_LAYOUT_GROUP, HANDLE_TOLERANCE_PX, LAYOUT_CUSTOM_COMMANDS, MOVE_GROUP, MOVE_SUBMENU_LABEL, MOVE_TARGETS,
    RESET_WORKBENCH_LAYOUT, RIGHT_STRIPE_BUTTON_PREFIX, RIGHT_STRIPE_ORDER_KEY, SPLIT_HANDLE_SELECTOR, TAB_ID_PREFIX, VIEW_LAYOUT_GROUP, type MoveArea
} from './layout-custom.consts';

/**
 * Layout customization (IDEA-127): right-click a tab or a stripe icon › Move to Left / Right / Bottom, Reset Layout
 * (gear and View menus), and double-click a divider to fit the panel to its content (again to restore).
 * Placement and sizes persist per workspace through the shell layout; the right stripe order is stored per workspace.
 */
@injectable()
export class IngotLayoutCustomContribution implements CommandContribution, MenuContribution, FrontendApplicationContribution {

    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(StorageService) protected readonly storage: StorageService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;

    /** Widget under the last right-click (a tab or a right stripe icon). */
    protected target?: Widget;
    protected readonly fits = new Map<MoveArea, FitState>();

    protected readonly onContextMenu = (event: MouseEvent): void => {
        this.target = this.widgetAt(event.target as HTMLElement | null);
    };

    /** The divider under the last pointerdown: Lumino captures the pointer on it (no mousedown), so the dblclick lands on the split panel. */
    protected pressedHandle?: { readonly handle: HTMLElement; readonly at: number };

    protected readonly onPointerDown = (event: PointerEvent): void => {
        const handle = (event.target as HTMLElement | null)?.closest<HTMLElement>(SPLIT_HANDLE_SELECTOR);
        this.pressedHandle = handle ? { handle, at: event.timeStamp } : undefined;
    };

    protected readonly onDoubleClick = (event: MouseEvent): void => {
        const pressed = this.pressedHandle && event.timeStamp - this.pressedHandle.at <= DOUBLE_CLICK_MS ? this.pressedHandle.handle : undefined;
        const handle = (event.target as HTMLElement | null)?.closest<HTMLElement>(SPLIT_HANDLE_SELECTOR) ?? pressed;
        const area = handle && this.areaOfHandle(handle);
        if (area) {
            event.preventDefault();
            event.stopPropagation();
            this.fit(area);
        }
    };

    onStart(): void {
        // Window capture runs before the document-level menus (IDEA-119) read the target.
        window.addEventListener('contextmenu', this.onContextMenu, true);
        document.addEventListener('pointerdown', this.onPointerDown, true);
        document.addEventListener('dblclick', this.onDoubleClick, true);
    }

    onStop(): void {
        window.removeEventListener('contextmenu', this.onContextMenu, true);
        document.removeEventListener('pointerdown', this.onPointerDown, true);
        document.removeEventListener('dblclick', this.onDoubleClick, true);
    }

    registerCommands(registry: CommandRegistry): void {
        for (const { area, command } of MOVE_TARGETS) {
            registry.registerCommand(command, {
                execute: () => this.target && this.move(this.target, area),
                isVisible: () => !!this.target && this.shell.getAreaFor(this.target) !== area
            });
        }
        registry.registerCommand(LAYOUT_CUSTOM_COMMANDS.reset, { execute: () => this.reset() });
    }

    registerMenus(menus: MenuModelRegistry): void {
        const places = [[...SHELL_TABBAR_CONTEXT_MENU, MOVE_GROUP], ...PANEL_BAR_ORDER.map(bar => [...panelsMenu(bar), '0_move'])];
        for (const path of places) {
            menus.registerSubmenu([...path, 'move'], MOVE_SUBMENU_LABEL);
            MOVE_TARGETS.forEach(({ command }, i) => menus.registerMenuAction([...path, 'move'], { commandId: command.id, order: String(i) }));
        }
        menus.registerMenuAction([...GEAR_MENU, GEAR_LAYOUT_GROUP], { commandId: LAYOUT_CUSTOM_COMMANDS.reset.id, label: `${LAYOUT_CUSTOM_COMMANDS.reset.label}` });
        menus.registerMenuAction([...CommonMenus.VIEW, VIEW_LAYOUT_GROUP], { commandId: LAYOUT_CUSTOM_COMMANDS.reset.id, label: LAYOUT_CUSTOM_COMMANDS.reset.label });
    }

    protected widgetAt(element: HTMLElement | null): Widget | undefined {
        const tab = element?.closest<HTMLElement>('.lm-TabBar-tab');
        if (tab?.id.startsWith(TAB_ID_PREFIX)) {
            return this.shell.getWidgetById(tab.id.slice(TAB_ID_PREFIX.length));
        }
        const button = element?.closest<HTMLElement>(`[id^="${RIGHT_STRIPE_BUTTON_PREFIX}"]`);
        const item = button && RIGHT_STRIPE_TOP.find(i => button.id === `${RIGHT_STRIPE_BUTTON_PREFIX}${i.id}`);
        return item?.kind === 'panel' ? this.shell.getWidgetById(item.widgetId) : undefined;
    }

    async move(widget: Widget, area: MoveArea): Promise<void> {
        if (this.shell.getAreaFor(widget) === area) {
            return;
        }
        await this.shell.addWidget(widget, { area });
        await this.shell.activateWidget(widget.id);
    }

    protected async reset(): Promise<void> {
        await this.storage.setData(this.stripeOrderKey(), undefined);
        await this.commands.executeCommand(RESET_WORKBENCH_LAYOUT);
    }

    stripeOrderKey(): string {
        return workspaceKey(RIGHT_STRIPE_ORDER_KEY, this.workspace.workspace?.resource.toString());
    }

    /** The side or bottom panel whose inner edge the divider sits on. */
    protected areaOfHandle(handle: HTMLElement): MoveArea | undefined {
        const h = handle.getBoundingClientRect();
        const near = (a: number, b: number) => Math.abs(a - b) <= HANDLE_TOLERANCE_PX;
        for (const area of ['left', 'right', 'bottom'] as const) {
            const panel = document.getElementById(AREA_PANEL_IDS[area]);
            if (!panel || !this.shell.isExpanded(area) || panel.offsetWidth === 0) {
                continue;
            }
            const p = panel.getBoundingClientRect();
            const vertical = h.height > h.width;
            if (area === 'left' && vertical && near(h.left, p.right)) {
                return area;
            }
            if (area === 'right' && vertical && near(h.right, p.left)) {
                return area;
            }
            if (area === 'bottom' && !vertical && near(h.bottom, p.top)) {
                return area;
            }
        }
        return undefined;
    }

    protected fit(area: MoveArea): void {
        const panel = document.getElementById(AREA_PANEL_IDS[area]);
        if (!panel) {
            return;
        }
        const horizontal = area !== 'bottom';
        const current = horizontal ? panel.offsetWidth : panel.offsetHeight;
        const content = horizontal ? this.contentWidth(panel) : this.contentHeight(panel);
        const { size, state } = toggleFit(current, content, horizontal ? window.innerWidth : window.innerHeight, this.fits.get(area) ?? {});
        this.fits.set(area, state);
        this.shell.resize(size, area);
        panel.dataset.ingotFit = state.previous === undefined ? 'restored' : 'fitted';
    }

    /** Widest content: the right edge of every element, counting text cut off with an ellipsis (scrollWidth). */
    protected contentWidth(panel: HTMLElement): number {
        const left = panel.getBoundingClientRect().left;
        let max = 0;
        const elements = panel.querySelectorAll<HTMLElement>('*');
        for (let i = 0; i < elements.length && i < FIT_MEASURE_LIMIT; i++) {
            const el = elements[i];
            const r = el.getBoundingClientRect();
            if (r.width === 0 || r.height === 0) {
                continue;
            }
            const overflow = Math.max(0, el.scrollWidth - el.clientWidth);
            max = Math.max(max, r.left - left + (el.children.length === 0 || overflow > 0 ? r.width + overflow : 0));
        }
        return max;
    }

    /** Tallest content: the current height plus whatever a scroller inside still hides. */
    protected contentHeight(panel: HTMLElement): number {
        let hidden = 0;
        const elements = panel.querySelectorAll<HTMLElement>('*');
        for (let i = 0; i < elements.length && i < FIT_MEASURE_LIMIT; i++) {
            hidden = Math.max(hidden, elements[i].scrollHeight - elements[i].clientHeight);
        }
        return panel.offsetHeight + hidden;
    }
}
