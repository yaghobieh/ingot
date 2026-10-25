import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { CommonMenus } from '@theia/core/lib/browser';
import { AboutDialog } from '@theia/core/lib/browser/about-dialog';
import { INGOT_COMMANDS } from './ingot-core.consts';

@injectable()
export class IngotCoreContribution implements CommandContribution, MenuContribution {

    @inject(AboutDialog)
    protected readonly about: AboutDialog;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(INGOT_COMMANDS.about, {
            execute: () => this.about.open()
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.HELP, { commandId: INGOT_COMMANDS.about.id, label: INGOT_COMMANDS.about.label });
    }
}
