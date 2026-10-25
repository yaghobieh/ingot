import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { NotificationManager } from '@theia/messages/lib/browser/notifications-manager';
import { ContextMenuRenderer } from '@theia/core/lib/browser/context-menu-renderer';
import { AGENTS_WIDGET_ID } from '../agents/agents.consts';
import { LAYOUT_CONTEXT_MENU } from '../layout/layout.browser-consts';
import { RIGHT_STRIPE_BOTTOM, RIGHT_STRIPE_ID, RIGHT_STRIPE_TOP, type RightStripeItem } from './tool-windows.consts';

/** Slim icon stripe on the right edge: Settings, Notifications, Agents, Database, MCP, Services, History (IDEA-61). */
@injectable()
export class IngotRightStripeWidget extends ReactWidget {

    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(NotificationManager) protected readonly notifications: NotificationManager;
    @inject(ContextMenuRenderer) protected readonly contextMenu: ContextMenuRenderer;

    protected notificationCount = 0;

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
        this.toDispose.push(this.shell.onDidRemoveWidget(() => this.refreshSoon()));
        this.shell.rightPanelHandler.dockPanel.layoutModified.connect(() => this.update());
        this.shell.bottomPanel.layoutModified.connect(() => this.update());
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

    protected renderItem(item: RightStripeItem): React.ReactNode {
        const badge = item.kind === 'notifications' && this.notificationCount > 0 ? this.notificationCount : undefined;
        return <button key={item.id} id={`ingot-rs-${item.id}`} type='button' title={item.title} aria-label={item.title}
            aria-pressed={this.isSelected(item)}
            className={`ingot-rs-button ${this.isSelected(item) ? 'selected' : ''}`}
            onClick={() => this.click(item)} onContextMenu={e => this.openContextMenu(item, e)}>
            <span className={`codicon codicon-${item.icon}`} />
            {badge !== undefined && <span className='ingot-rs-badge'>{badge > 9 ? '9+' : badge}</span>}
        </button>;
    }

    protected render(): React.ReactNode {
        return <div className='ingot-rs'>
            <div className='ingot-rs-group'>{RIGHT_STRIPE_TOP.map(i => this.renderItem(i))}</div>
            <div className='ingot-rs-group ingot-rs-bottom'>{RIGHT_STRIPE_BOTTOM.map(i => this.renderItem(i))}</div>
        </div>;
    }
}
