import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, type FrontendApplication, type FrontendApplicationContribution, type KeybindingContribution, type KeybindingRegistry } from '@theia/core/lib/browser';
import { CommandRegistry, type CommandContribution } from '@theia/core/lib/common/command';
import { isOSX } from '@theia/core/lib/common/os';
import { TOOL_WINDOW_KEYMAP } from '../../common/keymap/tool-windows.keymap.consts';
import { resolveKeymap } from '../../common/keymap/keymap.utils';
import { IngotMainToolbar } from './ingot-main-toolbar';
import { DEFAULT_LAYOUT_COMMANDS, INGOT_SHELL_COMMANDS } from './ingot-shell.consts';

type SideArea = 'left' | 'right' | 'bottom';
const SIDE_AREAS: readonly SideArea[] = ['left', 'right', 'bottom'];

/** Adds the main toolbar, the default tool window layout and tool window shortcuts (IDEA-13, IDEA-14). */
@injectable()
export class IngotShellContribution implements FrontendApplicationContribution, CommandContribution, KeybindingContribution {

    @inject(ApplicationShell)
    protected readonly shell: ApplicationShell;

    @inject(CommandRegistry)
    protected readonly commands: CommandRegistry;

    @inject(IngotMainToolbar)
    protected readonly toolbar: IngotMainToolbar;

    onStart(_app: FrontendApplication): void {
        this.shell.addWidget(this.toolbar, { area: 'top' });
        document.body.classList.add('ingot-shell');
    }

    async initializeLayout(_app: FrontendApplication): Promise<void> {
        for (const commandId of DEFAULT_LAYOUT_COMMANDS) {
            if (this.commands.getCommand(commandId)) {
                await this.commands.executeCommand(commandId);
            }
        }
    }

    /** Areas that were open before "Hide All Tool Windows", restored on the next toggle like JetBrains. */
    protected hiddenAreas: SideArea[] = [];

    protected async toggleAllToolWindows(): Promise<void> {
        const open = SIDE_AREAS.filter(area => this.shell.isExpanded(area));
        if (open.length) {
            this.hiddenAreas = open;
            await Promise.all(open.map(area => this.shell.collapsePanel(area)));
            return;
        }
        const restore = this.hiddenAreas.length ? this.hiddenAreas : (['left'] as SideArea[]);
        this.hiddenAreas = [];
        restore.forEach(area => this.shell.expandPanel(area));
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(INGOT_SHELL_COMMANDS.hideAllToolWindows, {
            execute: () => this.toggleAllToolWindows()
        });
        registry.registerCommand(INGOT_SHELL_COMMANDS.focusEditor, {
            execute: () => {
                const editor = this.shell.currentWidget && this.shell.getAreaFor(this.shell.currentWidget) === 'main' ? this.shell.currentWidget : this.shell.mainPanel.currentTitle?.owner;
                if (editor) {
                    this.shell.activateWidget(editor.id);
                }
            }
        });
    }

    registerKeybindings(keybindings: KeybindingRegistry): void {
        for (const binding of resolveKeymap(TOOL_WINDOW_KEYMAP, isOSX)) {
            if (!binding.when) {
                keybindings.unregisterKeybinding(binding.keybinding);
            }
            keybindings.registerKeybinding(binding);
        }
    }
}
