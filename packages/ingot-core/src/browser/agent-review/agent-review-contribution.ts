import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { AgentStore } from '../agents/agent-store';
import { ChangeTracker } from '../changes/change-tracker';
import { AGENT_REVIEW_COMMANDS, AGENT_REVIEW_WIDGET_ID } from './agent-review.consts';
import type { AgentReviewWidget } from './agent-review-widget';

/** IDEA-268: "Review Agent Changes" opens the multi-file review tab for a chat (the current one by default). */
@injectable()
export class AgentReviewContribution implements CommandContribution {

    @inject(WidgetManager) protected readonly widgets: WidgetManager;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(AgentStore) protected readonly store: AgentStore;
    @inject(ChangeTracker) protected readonly tracker: ChangeTracker;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(AGENT_REVIEW_COMMANDS.open, {
            execute: (sessionId?: unknown) => this.open(typeof sessionId === 'string' ? sessionId : undefined),
            isEnabled: () => !!this.store.current || this.tracker.pending().length > 0
        });
    }

    async open(sessionId?: string): Promise<AgentReviewWidget> {
        const widget = await this.widgets.getOrCreateWidget<AgentReviewWidget>(AGENT_REVIEW_WIDGET_ID);
        widget.showSession(sessionId ?? this.store.current?.id ?? this.tracker.pending()[0]?.sessionId);
        if (!widget.isAttached) {
            await this.shell.addWidget(widget, { area: 'main' });
        }
        await this.shell.activateWidget(widget.id);
        return widget;
    }
}
