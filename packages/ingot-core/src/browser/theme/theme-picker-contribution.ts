import { inject, injectable } from '@theia/core/shared/inversify';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { THEME_PICKER_COMMAND } from '../../common/theme/theme-store.consts';
import { ThemePickerDialog } from './theme-picker-dialog';

/** IDEA-144: "Color Theme…" opens the theme picker (Settings › Appearance, gear menu, command palette). */
@injectable()
export class ThemePickerContribution implements CommandContribution {

    @inject(ThemePickerDialog) protected readonly dialog: ThemePickerDialog;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(THEME_PICKER_COMMAND, { execute: () => this.dialog.pick() });
    }
}
