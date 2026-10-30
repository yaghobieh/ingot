import { injectable, inject } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import type { CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { BROWSER_WIDGET_ID, BROWSER_WIDGET_LABEL } from '../../common/browser-tool/browser-tool.consts';
import { commentMessage, quoteForComposer } from '../../common/browser-tool/browser-tool.utils';
import { IngotAgentsContribution } from '../agents/agents-contribution';
import { AgentStore } from '../agents/agent-store';
import { IngotBrowserWidget } from './browser-widget';
import { BrowserController } from './browser-controller';
import { BROWSER_COMMANDS } from './browser-tool.browser-consts';

/** IDEA-130 / IDEA-289: Browser panel commands. */
@injectable()
export class IngotBrowserContribution extends AbstractViewContribution<IngotBrowserWidget> {

    @inject(BrowserController) protected readonly controller: BrowserController;
    @inject(IngotAgentsContribution) protected readonly agents: IngotAgentsContribution;
    @inject(AgentStore) protected readonly store: AgentStore;
    @inject(MessageService) protected readonly messages: MessageService;

    constructor() {
        super({ widgetId: BROWSER_WIDGET_ID, widgetName: BROWSER_WIDGET_LABEL, defaultWidgetOptions: { area: 'main', mode: 'split-right' } });
    }

    override registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(BROWSER_COMMANDS.open, {
            execute: async (url?: unknown) => {
                if (this.controller.control === 'agent' && !this.controller.agentDriving) {
                    this.controller.takeControl();
                }
                await this.controller.open(true);
                if (typeof url === 'string') {
                    await this.controller.navigate(url);
                }
            }
        });
        registry.registerCommand(BROWSER_COMMANDS.toggleControl, { execute: () => this.controller.toggleControl() });
        registry.registerCommand(BROWSER_COMMANDS.openExternal, {
            execute: () => {
                if (!this.controller.openExternal()) {
                    this.messages.info('Open a page in the Browser panel first.');
                }
            }
        });
        registry.registerCommand(BROWSER_COMMANDS.quoteSelection, { execute: () => this.quote() });
        registry.registerCommand(BROWSER_COMMANDS.commentSelection, {
            execute: () => {
                if (this.controller.selection) {
                    this.controller.startComment();
                } else {
                    this.messages.info('Select some text on the page first.');
                }
            }
        });
        registry.registerCommand(BROWSER_COMMANDS.sendComment, { execute: (comment?: unknown) => this.sendComment(typeof comment === 'string' ? comment : '') });
    }

    /** IDEA-289: the selection (and its page) goes into the chat composer; the user keeps typing there. */
    protected async quote(): Promise<void> {
        const selection = this.controller.selection;
        if (!selection) {
            this.messages.info('Select some text on the page first.');
            return;
        }
        const widget = await this.agents.openView({ activate: true, reveal: true });
        widget.addContext(quoteForComposer(selection));
        this.controller.clearSelection();
    }

    /** IDEA-289: the selection with the user's note is sent to the agent as a chat message. */
    protected async sendComment(comment: string): Promise<void> {
        const selection = this.controller.selection;
        if (!selection || !comment.trim()) {
            return;
        }
        await this.agents.openView({ activate: false, reveal: true });
        this.store.send(commentMessage(selection, comment));
        this.controller.clearSelection();
    }
}
