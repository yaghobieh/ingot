import { inject, injectable } from '@theia/core/shared/inversify';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import type { MenuContribution, MenuModelRegistry } from '@theia/core/lib/common/menu';
import { ApplicationShell, CommonCommands, CommonMenus, type FrontendApplicationContribution, type Widget } from '@theia/core/lib/browser';
import { IngotSettingsDialog } from './ingot-settings-dialog';
import { ADVANCED_SETTINGS_COMMAND, LEGACY_SETTINGS_WIDGET_ID, SETTINGS_OPEN_COMMAND, SettingsDialogProvider } from './settings.browser-consts';

@injectable()
export class IngotSettingsContribution implements CommandContribution, MenuContribution, FrontendApplicationContribution {

    /** Resolved lazily: the dialog depends on services with asynchronous initialization. */
    @inject(SettingsDialogProvider)
    protected readonly dialog: () => Promise<IngotSettingsDialog>;

    @inject(ApplicationShell) protected readonly shell: ApplicationShell;

    /** Set only while the Settings dialog's "All settings" link opens the full settings list on purpose. */
    protected allowLegacy = false;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(SETTINGS_OPEN_COMMAND, {
            execute: async (pageId?: unknown) => (await this.dialog()).show(typeof pageId === 'string' ? pageId : undefined)
        });
        // Every generic "Open Settings" entry point (menus, ⌘,, command palette, plugins) opens Ingot Settings.
        registry.registerHandler(CommonCommands.OPEN_PREFERENCES.id, {
            isEnabled: () => !this.allowLegacy,
            execute: () => registry.executeCommand(SETTINGS_OPEN_COMMAND.id)
        });
        registry.registerCommand(ADVANCED_SETTINGS_COMMAND, {
            execute: async () => {
                this.allowLegacy = true;
                try {
                    await registry.executeCommand(CommonCommands.OPEN_PREFERENCES.id);
                } finally {
                    this.allowLegacy = false;
                }
            }
        });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.FILE_SETTINGS_SUBMENU_OPEN, { commandId: SETTINGS_OPEN_COMMAND.id, label: 'Settings…', order: '0' });
    }

    /** A settings tab restored from an older session is replaced by Ingot Settings once. */
    onDidInitializeLayout(): void {
        const legacy = this.shell.widgets.filter(w => w.id === LEGACY_SETTINGS_WIDGET_ID);
        legacy.forEach(w => w.close());
        if (legacy.length) {
            this.dialog().then(d => d.show());
        }
        this.shell.onDidAddWidget((w: Widget) => {
            if (w.id === LEGACY_SETTINGS_WIDGET_ID && !this.allowLegacy) {
                w.close();
            }
        });
    }
}
