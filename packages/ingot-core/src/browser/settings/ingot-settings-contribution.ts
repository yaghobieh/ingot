import { inject, injectable } from '@theia/core/shared/inversify';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import type { MenuContribution, MenuModelRegistry } from '@theia/core/lib/common/menu';
import { CommonMenus } from '@theia/core/lib/browser';
import { IngotSettingsDialog } from './ingot-settings-dialog';
import { SETTINGS_OPEN_COMMAND, SettingsDialogProvider } from './settings.browser-consts';

@injectable()
export class IngotSettingsContribution implements CommandContribution, MenuContribution {

    /** Resolved lazily: the dialog depends on services with asynchronous initialization. */
    @inject(SettingsDialogProvider)
    protected readonly dialog: () => Promise<IngotSettingsDialog>;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(SETTINGS_OPEN_COMMAND, {
            execute: async (pageId?: unknown) => (await this.dialog()).show(typeof pageId === 'string' ? pageId : undefined)
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.FILE_SETTINGS_SUBMENU_OPEN, { commandId: SETTINGS_OPEN_COMMAND.id, label: 'Settings…', order: '0' });
    }
}
