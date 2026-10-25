import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry, MessageService } from '@theia/core/lib/common';
import { CommonMenus } from '@theia/core/lib/browser';
import { formatAboutText } from '../common/product.utils';
import { INGOT_COMMANDS } from './ingot-core.consts';

@injectable()
export class IngotCoreContribution implements CommandContribution, MenuContribution {

    @inject(MessageService)
    protected readonly messages: MessageService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(INGOT_COMMANDS.about, {
            execute: () => this.messages.info(formatAboutText())
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.HELP, { commandId: INGOT_COMMANDS.about.id, label: INGOT_COMMANDS.about.label });
    }
}
