import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import type { CommandRegistry } from '@theia/core/lib/common';
import { ThreadsService } from './threads-service';
import { ThreadsWidget } from './threads-widget';
import { THREADS_COMMANDS, THREADS_LABEL, THREADS_WIDGET_ID } from './threads.consts';

/** IDEA-268: Threads tool window (left) and "New Thread in Git Worktree". */
@injectable()
export class ThreadsContribution extends AbstractViewContribution<ThreadsWidget> {

    @inject(ThreadsService) protected readonly threads: ThreadsService;

    constructor() {
        super({ widgetId: THREADS_WIDGET_ID, widgetName: THREADS_LABEL, defaultWidgetOptions: { area: 'left', rank: 600 }, toggleCommandId: THREADS_COMMANDS.toggle.id });
    }

    override registerCommands(registry: CommandRegistry): void {
        super.registerCommands(registry);
        registry.registerCommand(THREADS_COMMANDS.newWorktree, { execute: () => this.threads.newThread(true) });
    }
}
