import { injectable, inject } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import type { CommandRegistry } from '@theia/core/lib/common/command';
import { Command } from '@theia/core/lib/common/command';
import { BROWSER_WIDGET_ID, BROWSER_WIDGET_LABEL } from '../../common/browser-tool/browser-tool.consts';
import { IngotBrowserWidget } from './browser-widget';
import { BrowserController } from './browser-controller';

export const BROWSER_COMMANDS = {
    open: Command.toDefaultLocalizedCommand({ id: 'ingot.browser.open', category: 'Browser', label: 'Open Browser' }),
    toggleControl: Command.toDefaultLocalizedCommand({ id: 'ingot.browser.toggleControl', category: 'Browser', label: 'Take / Give Back Browser Control' })
};

/** IDEA-130: Browser panel commands. */
@injectable()
export class IngotBrowserContribution extends AbstractViewContribution<IngotBrowserWidget> {

    @inject(BrowserController) protected readonly controller: BrowserController;

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
    }
}
