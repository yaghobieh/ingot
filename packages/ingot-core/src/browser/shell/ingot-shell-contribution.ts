import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, type FrontendApplication, type FrontendApplicationContribution, type KeybindingContribution, type KeybindingRegistry } from '@theia/core/lib/browser';
import { CommandRegistry, type CommandContribution } from '@theia/core/lib/common/command';
import { isOSX } from '@theia/core/lib/common/os';
import { TOOL_WINDOW_KEYMAP } from '../../common/keymap/tool-windows.keymap.consts';
import { resolveKeymap } from '../../common/keymap/keymap.utils';
import type { PanelLayout } from '@theia/core/shared/@lumino/widgets';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { IngotMainToolbar } from './ingot-main-toolbar';
import { IngotStripeWidget } from '../stripe/ingot-stripe-widget';
import { IngotRightStripeWidget } from '../tool-windows/right-stripe-widget';
import { IngotAgentsContribution } from '../agents/agents-contribution';
import { IngotLayoutContribution } from '../layout/layout-contribution';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { ViewContainer } from '@theia/core/lib/browser/view-container';
import { IngotProjectTabsWidget } from '../groups/project-tabs-widget';
import { pinProjectLabel } from '../navigator/project-label';
import { IngotExplorerHeader } from '../navigator/explorer-header';
import { EXPLORER_CONTAINER_ID } from '../navigator/navigator.consts';
import { DEFAULT_LAYOUT_COMMANDS, INGOT_SHELL_COMMANDS } from './ingot-shell.consts';
import { ShellLayoutRestorer } from '@theia/core/lib/browser/shell/shell-layout-restorer';
import { IngotShellLayoutRestorer } from '../workbench/agents-window-layout-restorer';


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

    @inject(IngotRightStripeWidget)
    protected readonly rightStripe: IngotRightStripeWidget;

    @inject(WorkspaceService)
    protected readonly workspace: WorkspaceService;

    @inject(IngotAgentsContribution)
    protected readonly agents: IngotAgentsContribution;

    @inject(WidgetManager)
    protected readonly widgets: WidgetManager;

    @inject(IngotProjectTabsWidget)
    protected readonly projectTabs: IngotProjectTabsWidget;

    @inject(IngotExplorerHeader)
    protected readonly explorerHeader: IngotExplorerHeader;

    @inject(ShellLayoutRestorer)
    protected readonly layoutRestorer: ShellLayoutRestorer;

    @inject(IngotLayoutContribution)
    protected readonly layout: IngotLayoutContribution;

    onStart(_app: FrontendApplication): void {
        this.shell.addWidget(this.toolbar, { area: 'top' });
        this.shell.addWidget(this.projectTabs, { area: 'top' });
        document.body.classList.add('ingot-shell');
    }

    async onDidInitializeLayout(app: FrontendApplication): Promise<void> {
        // Electron hides the top panel on macOS (native menu); the Ingot main toolbar lives there.
        this.shell.topPanel.show();
        this.attachStripe();
        // The right edge gets Ingot's own slim stripe instead of Theia's side tabs (IDEA-61).
        this.attachRightStripe();
        // IDEA-281: a restored layout keeps the chat and the bottom panel open or closed as the user left them;
        // only a fresh window gets the reference layout.
        const restorer = this.layoutRestorer instanceof IngotShellLayoutRestorer ? this.layoutRestorer : undefined;
        const restored = !!restorer?.restored;
        await this.agents.openView({ activate: false, reveal: !restored });
        this.rightStripe.refreshSoon();
        this.renameProjectView();
        if (!restored) {
            // The reference layout keeps the bottom panel closed; the Terminal opens from the stripe or ⌥F12.
            this.shell.collapsePanel('bottom');
        }
        // Chat on the right or at the bottom, as the user chose (IDEA-85).
        await this.layout.start(restored);
        this.rightStripe.refreshSoon();
        restorer?.keepStored(app);
    }

    /** The file tree is labelled with the project name, with a fold chevron and file actions (IDEA-93). */
    protected async renameProjectView(): Promise<void> {
        const explorer = await this.widgets.getWidget(EXPLORER_CONTAINER_ID);
        if (explorer instanceof ViewContainer) {
            const refresh = pinProjectLabel(explorer, () => this.workspace.tryGetRoots()[0]?.resource.path.base);
            this.workspace.onWorkspaceChanged(() => refresh());
            this.explorerHeader.attach();
            // Only the file tree: no Open Editors or script sections under PROJECT (plugins add theirs later).
            const filesOnly = (): void => explorer.getParts().filter(part => part.wrapped.id !== 'files' && !part.isHidden).forEach(part => part.setHidden(true));
            filesOnly();
            explorer.onDidChangeTrackableWidgets(() => filesOnly());
        }
    }

    /** Puts the bottom tool window group (Terminal, Run, Problems, Ports, Git) into the left stripe. */
    protected attachStripe(): void {
        const bottomMenu = this.shell.leftPanelHandler.bottomMenu;
        const layout = bottomMenu.parent?.layout as PanelLayout | undefined;
        if (!layout || layout.widgets.includes(this.stripe)) {
            return;
        }
        // Directly under the side bar tabs, so the stripe reads Project, Search, Git, Terminal.
        layout.insertWidget(layout.widgets.indexOf(this.shell.leftPanelHandler.tabBar) + 1, this.stripe);
    }

    /** Replaces the right side tab bar with the tool window stripe: Settings, Notifications, Agents, Database, MCP, Services. */
    protected attachRightStripe(): void {
        const handler = this.shell.rightPanelHandler;
        const layout = handler.tabBar.parent?.layout as PanelLayout | undefined;
        if (!layout || layout.widgets.includes(this.rightStripe)) {
            return;
        }
        document.body.classList.add('ingot-right-stripe-on');
        layout.addWidget(this.rightStripe);
        // The Agents window draws its own header (Agents | History); the empty side panel title bar is not part of the design.
        handler.toolBar.hide();
    }

    async initializeLayout(_app: FrontendApplication): Promise<void> {
        for (const commandId of DEFAULT_LAYOUT_COMMANDS) {
            if (this.commands.getCommand(commandId)) {
                await this.commands.executeCommand(commandId);
            }
        }
        // Default Agents width per the reference (~27% of the window).
        this.shell.resize(Math.round(Math.max(320, window.innerWidth * 0.27)), 'right');
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
