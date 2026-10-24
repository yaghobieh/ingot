import { inject, injectable } from '@theia/core/shared/inversify';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import type { MenuContribution, MenuModelRegistry } from '@theia/core/lib/common/menu';
import { CommonMenus } from '@theia/core/lib/browser';
import { IngotSettingsDialog } from './ingot-settings-dialog';
import { SETTINGS_OPEN_COMMAND } from './settings.browser-consts';

@injectable()
export class IngotSettingsContribution implements CommandContribution, MenuContribution {

    @inject(IngotSettingsDialog)
    protected readonly dialog: IngotSettingsDialog;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(SETTINGS_OPEN_COMMAND, {
            execute: (pageId?: unknown) => this.dialog.show(typeof pageId === 'string' ? pageId : undefined)
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.FILE_SETTINGS_SUBMENU_OPEN, { commandId: SETTINGS_OPEN_COMMAND.id, label: 'Settings…', order: '0' });
    }
}
