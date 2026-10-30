import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, WidgetManager, type WidgetFactory } from '@theia/core/lib/browser';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import URI from '@theia/core/lib/common/uri';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { LOCAL_HISTORY_COMMANDS } from '../../common/local-history/local-history.consts';
import { LocalHistoryService } from './local-history-service';
import { LOCAL_HISTORY_TEXT, LOCAL_HISTORY_WIDGET_ID } from './local-history.browser-consts';
import type { LocalHistoryWidget, LocalHistoryWidgetOptions } from './local-history-widget';

export const createLocalHistoryWidgetFactory = (create: (options: LocalHistoryWidgetOptions) => LocalHistoryWidget): WidgetFactory => ({
    id: LOCAL_HISTORY_WIDGET_ID,
    createWidget: (options: LocalHistoryWidgetOptions) => create(options)
});

/** Show Local History (IDEA-262) for the file in the active editor. */
@injectable()
export class LocalHistoryContribution implements CommandContribution {

    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(WidgetManager) protected readonly widgets: WidgetManager;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(LocalHistoryService) protected readonly history: LocalHistoryService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(LOCAL_HISTORY_COMMANDS.show, { execute: (uri?: URI) => this.show(uri instanceof URI ? uri : undefined) });
    }

    async show(target?: URI): Promise<LocalHistoryWidget | undefined> {
        const uri = target ?? (this.editors.currentEditor ?? this.editors.activeEditor)?.editor.uri;
        if (!uri) {
            this.messages.info(LOCAL_HISTORY_TEXT.noEditor);
            return undefined;
        }
        if (!this.history.location(uri)) {
            this.messages.info(LOCAL_HISTORY_TEXT.noWorkspaceFile);
            return undefined;
        }
        const options: LocalHistoryWidgetOptions = { uri: uri.toString() };
        const widget = await this.widgets.getOrCreateWidget<LocalHistoryWidget>(LOCAL_HISTORY_WIDGET_ID, options);
        if (!widget.isAttached) {
            await this.shell.addWidget(widget, { area: 'main' });
        }
        await this.shell.activateWidget(widget.id);
        await widget.refresh();
        return widget;
    }
}
