import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { NotificationManager } from '@theia/messages/lib/browser/notifications-manager';
import { ContextMenuRenderer } from '@theia/core/lib/browser/context-menu-renderer';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { applyOrder, reorderIds, workspaceKey } from '../../common/workbench/layout-custom.utils';
import { RIGHT_STRIPE_ORDER_KEY } from '../workbench/layout-custom.consts';
import { AGENTS_WIDGET_ID } from '../agents/agents.consts';
import { LAYOUT_CONTEXT_MENU } from '../layout/layout.browser-consts';
import { IngotPlanService } from '../plan/plan-service';
import { RIGHT_STRIPE_BOTTOM, RIGHT_STRIPE_ID, RIGHT_STRIPE_TOP, type RightStripeItem } from './tool-windows.consts';

/** Slim icon stripe on the right edge: Settings, Notifications, Agents, Database, MCP, Services, History (IDEA-61). */
@injectable()
export class IngotRightStripeWidget extends ReactWidget {

    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(NotificationManager) protected readonly notifications: NotificationManager;
    @inject(ContextMenuRenderer) protected readonly contextMenu: ContextMenuRenderer;

    @inject(StorageService) protected readonly storage: StorageService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(IngotPlanService) protected readonly plan: IngotPlanService;

    protected notificationCount = 0;
    /** Saved per-workspace order of the top group (IDEA-127); unknown or new items keep their default place. */
    protected order: string[] = [];
    protected dragging?: string;

    @postConstruct()
    protected init(): void {
        this.id = RIGHT_STRIPE_ID;
        this.addClass('ingot-right-stripe');
        this.toDispose.push(this.shell.onDidChangeCurrentWidget(() => this.update()));
        this.toDispose.push(this.shell.onDidChangeActiveWidget(() => this.update()));
        this.toDispose.push(this.notifications.onUpdated(event => {
            this.notificationCount = event.notifications.length;
            this.update();
        }));
        this.toDispose.push(this.shell.onDidAddWidget(() => this.refreshSoon()));
        this.toDispose.push(this.plan.onDidChange(() => this.update()));
        this.toDispose.push(this.shell.onDidRemoveWidget(() => this.refreshSoon()));
        this.shell.rightPanelHandler.dockPanel.layoutModified.connect(() => this.update());
        this.shell.bottomPanel.layoutModified.connect(() => this.update());
        this.update();
        this.loadOrder();
        // Capture phase: the shell swallows drag events before React sees them, so drop would never fire.
        const over = (e: DragEvent) => {
            if (this.dragging && this.dropTarget(e)) {
                // Ours: keep the shell's file-drop handling from vetoing it.
                e.preventDefault();
                e.stopPropagation();
                if (e.dataTransfer) {
                    e.dataTransfer.dropEffect = 'move';
                }
            }
        };
        const drop = (e: DragEvent) => {
            const target = this.dragging && this.dropTarget(e);
            if (target) {
                e.stopPropagation();
                this.drop(target, e);
            }
        };
        const events: [string, (e: DragEvent) => void][] = [['dragenter', over], ['dragover', over], ['drop', drop]];
        events.forEach(([type, listener]) => document.addEventListener(type, listener as EventListener, true));
        this.toDispose.push({ dispose: () => events.forEach(([type, listener]) => document.removeEventListener(type, listener as EventListener, true)) });
    }

    /** Top-group item id under a drag event, if any. */
    protected dropTarget(event: DragEvent): string | undefined {
        const button = (event.target as HTMLElement | null)?.closest<HTMLElement>('.ingot-rs-button[draggable="true"]');
        return button && this.node.contains(button) ? button.id.replace(/^ingot-rs-/, '') : undefined;
    }

    protected orderKey(): string {
        return workspaceKey(RIGHT_STRIPE_ORDER_KEY, this.workspace.workspace?.resource.toString());
    }

    protected async loadOrder(): Promise<void> {
        await this.workspace.ready;
        this.order = await this.storage.getData<string[]>(this.orderKey(), []) ?? [];
        this.update();
    }

    protected topItems(): readonly RightStripeItem[] {
        const items = applyOrder(RIGHT_STRIPE_TOP, this.order);
        return this.plan.can('chat') ? items : items.filter(i => i.kind !== 'panel' || i.widgetId !== AGENTS_WIDGET_ID);
    }

    /** Drop one icon onto another: it takes that icon's place (HTML5 drag and drop). */
    protected drop(targetId: string, event: DragEvent): void {
        event.preventDefault();
        const from = this.dragging ?? event.dataTransfer?.getData('text/plain');
        this.dragging = undefined;
        if (!from || from === targetId) {
            return;
        }
        this.order = reorderIds(this.topItems().map(i => i.id), from, targetId);
        this.storage.setData(this.orderKey(), this.order);
        this.update();
    }

    isSelected(item: RightStripeItem): boolean {
        if (item.kind === 'notifications') {
            return this.notifications.centerVisible;
        }
        if (item.kind !== 'panel') {
            return false;
        }
        const widget = this.shell.getWidgetById(item.widgetId);
        if (!widget || !widget.isVisible) {
            return false;
        }
        const area = this.shell.getAreaFor(widget);
        return area === 'main' || (!!area && area !== 'top' && this.shell.isExpanded(area));
    }

    protected async click(item: RightStripeItem): Promise<void> {
        if (item.kind === 'notifications') {
            this.notifications.toggleCenter();
        } else if (item.kind === 'command') {
            await this.commands.executeCommand(item.command);
        } else if (this.isSelected(item)) {
            const widget = this.shell.getWidgetById(item.widgetId);
            const area = widget && this.shell.getAreaFor(widget);
            if (area === 'left' || area === 'right' || area === 'bottom') {
                await this.shell.collapsePanel(area);
            }
        } else {
            await this.commands.executeCommand(item.command);
            const widget = this.shell.getWidgetById(item.widgetId);
            if (widget) {
                await this.shell.activateWidget(widget.id);
            }
        }
        this.refreshSoon();
    }

    /** Side panels expand and collapse with an animation; re-read the selection once it has settled. */
    refreshSoon(): void {
        this.update();
        for (const delay of [60, 250, 600]) {
            setTimeout(() => !this.isDisposed && this.update(), delay);
        }
    }

    /** Right-click on the AI button: chat on the right or at the bottom (IDEA-85). */
    protected openContextMenu(item: RightStripeItem, event: React.MouseEvent): void {
        if (item.kind !== 'panel' || item.widgetId !== AGENTS_WIDGET_ID) {
            return;
        }
        event.preventDefault();
        this.contextMenu.render({ menuPath: LAYOUT_CONTEXT_MENU, anchor: { x: event.clientX, y: event.clientY }, context: event.currentTarget as HTMLElement });
    }

    protected renderItem(item: RightStripeItem, top = false): React.ReactNode {
        const badge = item.kind === 'notifications' && this.notificationCount > 0 ? this.notificationCount : undefined;
        return <button key={item.id} id={`ingot-rs-${item.id}`} type='button' title={item.title} aria-label={item.title}
            aria-pressed={this.isSelected(item)}
            className={`ingot-rs-button ${this.isSelected(item) ? 'selected' : ''}`}
            draggable={!!top}
            onDragStart={top ? e => { this.dragging = item.id; e.dataTransfer.setData('text/plain', item.id); e.dataTransfer.effectAllowed = 'move'; } : undefined}
            onDragEnd={() => { this.dragging = undefined; }}
            onClick={() => this.click(item)} onContextMenu={e => this.openContextMenu(item, e)}>
            <span className={`codicon codicon-${item.icon}`} />
            {badge !== undefined && <span className='ingot-rs-badge'>{badge > 9 ? '9+' : badge}</span>}
        </button>;
    }

    protected render(): React.ReactNode {
        return <div className='ingot-rs'>
            <div className='ingot-rs-group'>{this.topItems().map(i => this.renderItem(i, true))}</div>
            <div className='ingot-rs-group ingot-rs-bottom'>{RIGHT_STRIPE_BOTTOM.map(i => this.renderItem(i))}</div>
        </div>;
    }
}
