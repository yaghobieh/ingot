import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, type FrontendApplication, type FrontendApplicationContribution, type KeybindingContribution, type KeybindingRegistry } from '@theia/core/lib/browser';
import { CommandRegistry, type CommandContribution } from '@theia/core/lib/common/command';
import { isOSX } from '@theia/core/lib/common/os';
import { TOOL_WINDOW_KEYMAP } from '../../common/keymap/tool-windows.keymap.consts';
import { resolveKeymap } from '../../common/keymap/keymap.utils';
import type { PanelLayout } from '@theia/core/shared/@lumino/widgets';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { IngotMainToolbar } from './ingot-main-toolbar';
import { IngotStripeWidget } from '../stripe/ingot-stripe-widget';
import { IngotAgentsContribution } from '../agents/agents-contribution';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { ViewContainer } from '@theia/core/lib/browser/view-container';
import { IngotProjectTabsWidget } from '../groups/project-tabs-widget';
import { pinProjectLabel } from '../navigator/project-label';
import { DEFAULT_LAYOUT_COMMANDS, INGOT_SHELL_COMMANDS } from './ingot-shell.consts';

const EXPLORER_CONTAINER_ID = 'explorer-view-container';

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

    @inject(IngotStripeWidget)
    protected readonly stripe: IngotStripeWidget;

    @inject(TerminalService)
    protected readonly terminals: TerminalService;

    @inject(WorkspaceService)
    protected readonly workspace: WorkspaceService;

    @inject(IngotAgentsContribution)
    protected readonly agents: IngotAgentsContribution;

    @inject(WidgetManager)
    protected readonly widgets: WidgetManager;

    @inject(IngotProjectTabsWidget)
    protected readonly projectTabs: IngotProjectTabsWidget;

    onStart(_app: FrontendApplication): void {
        this.shell.addWidget(this.toolbar, { area: 'top' });
        this.shell.addWidget(this.projectTabs, { area: 'top' });
        document.body.classList.add('ingot-shell');
    }

    async onDidInitializeLayout(_app: FrontendApplication): Promise<void> {
        // Electron hides the top panel on macOS (native menu); the Ingot main toolbar lives there.
        this.shell.topPanel.show();
        this.attachStripe();
        await this.agents.openView({ activate: false, reveal: true });
        this.renameProjectView();
        await this.workspace.ready;
        if (this.workspace.opened) {
            await this.ensureTerminal();
        }
    }

    /** Ingot calls the file tree "Project". */
    protected async renameProjectView(): Promise<void> {
        const explorer = await this.widgets.getWidget(EXPLORER_CONTAINER_ID);
        if (explorer instanceof ViewContainer) {
            pinProjectLabel(explorer);
        }
    }

    /** Puts the bottom tool window group (Terminal, Run, Problems, Ports, Git) into the left stripe. */
    protected attachStripe(): void {
        const bottomMenu = this.shell.leftPanelHandler.bottomMenu;
        const layout = bottomMenu.parent?.layout as PanelLayout | undefined;
        if (!layout || layout.widgets.includes(this.stripe)) {
            return;
        }
        layout.insertWidget(layout.widgets.indexOf(bottomMenu), this.stripe);
    }

    /** Ingot keeps a Terminal docked at the bottom; make sure one exists without stealing focus. */
    protected async ensureTerminal(): Promise<void> {
        let [terminal] = this.terminals.all;
        if (!terminal) {
            terminal = await this.terminals.newTerminal({ title: 'Local' });
            await terminal.start();
            this.terminals.open(terminal, { widgetOptions: { area: 'bottom' }, mode: 'reveal' });
        }
        this.shell.expandPanel('bottom');
        await this.shell.revealWidget(terminal.id);
    }

    async initializeLayout(_app: FrontendApplication): Promise<void> {
        for (const commandId of DEFAULT_LAYOUT_COMMANDS) {
            if (this.commands.getCommand(commandId)) {
                await this.commands.executeCommand(commandId);
            }
        }
    }

    /** Areas that were open before "Hide All Tool Windows", restored on the next toggle like classic IDEs. */
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
