import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { ElectronMainMenuFactory } from '@theia/core/lib/electron-browser/menu/electron-main-menu-factory';
import type { MenuDto } from '@theia/core/lib/electron-common/electron-api';
import { PRODUCT } from '../common/product.consts';
import { buildAppMenu } from '../common/shell/app-menu';

/** Replaces the default macOS application menu with Ingot's: About, Settings… (Cmd+,), Hide, Quit (IDEA-69). */
@injectable()
export class IngotElectronMenuFactory extends ElectronMainMenuFactory {

    @inject(CommandRegistry) protected readonly ingotCommands: CommandRegistry;

    protected override createOSXMenu(): MenuDto {
        return buildAppMenu(PRODUCT.name, commandId => {
            if (this.ingotCommands.getCommand(commandId)) {
                this.ingotCommands.executeCommand(commandId);
            }
        });
    }
}
