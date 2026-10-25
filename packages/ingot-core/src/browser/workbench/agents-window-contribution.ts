import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { AGENTS_WIDGET_ID } from '../agents/agents.consts';
import { AgentsWindowOpener, currentAgentsWindowUrl, isAgentsWindow } from './agents-window';
import { AGENTS_WINDOW_BODY_CLASS, AGENTS_WINDOW_TITLE, TITLEBAR_COMMANDS } from './titlebar.consts';

const SIDE_AREAS = ['left', 'right', 'bottom'] as const;

/**
 * Agents Window (IDEA-118): a second window for the same project that shows only the agents chat, full size.
 * It never saves its layout, so the main window's layout stays as it was.
 */
@injectable()
export class IngotAgentsWindowContribution implements CommandContribution, FrontendApplicationContribution {

    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(WidgetManager) protected readonly widgets: WidgetManager;
    @inject(AgentsWindowOpener) protected readonly opener: AgentsWindowOpener;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(TITLEBAR_COMMANDS.agentsWindow, { execute: () => this.opener.open(currentAgentsWindowUrl()) });
    }

    onStart(): void {
        if (isAgentsWindow()) {
            document.body.classList.add(AGENTS_WINDOW_BODY_CLASS);
        }
    }

    async onDidInitializeLayout(): Promise<void> {
        if (!isAgentsWindow()) {
            return;
        }
        const widget = await this.widgets.getOrCreateWidget(AGENTS_WIDGET_ID);
        await this.shell.addWidget(widget, { area: 'main' });
        await this.shell.activateWidget(widget.id);
        widget.title.closable = false;
        for (const area of SIDE_AREAS) {
            await this.shell.collapsePanel(area);
        }
        document.title = AGENTS_WINDOW_TITLE;
    }
}
