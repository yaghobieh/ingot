import { inject, injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { StatusBar, StatusBarAlignment } from '@theia/core/lib/browser/status-bar';
import type { KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { WidgetManager } from '@theia/core/lib/browser/widget-manager';
import { COMMIT_COMMANDS, COMMIT_WINDOW_STATUS_ID, LOCAL_CHANGES_WIDGET_ID } from './commit.consts';
import { CommitWindow } from './commit-window';
import { LocalChangesModel } from './local-changes-model';
import type { LocalChangesWidget } from './local-changes-widget';

/** IDEA-176: Open Commit Window (command, ⌥⇧⌘K, status bar) and Commit with AI for the docked view. */
@injectable()
export class CommitWindowContribution implements FrontendApplicationContribution, CommandContribution, KeybindingContribution {

    @inject(CommitWindow) protected readonly window: CommitWindow;
    @inject(LocalChangesModel) protected readonly model: LocalChangesModel;
    @inject(StatusBar) protected readonly statusBar: StatusBar;
    @inject(WidgetManager) protected readonly widgets: WidgetManager;

    onStart(): void {
        this.updateStatus();
        this.model.onDidChange(() => this.updateStatus());
    }

    protected updateStatus(): void {
        if (!this.model.root) {
            this.statusBar.removeElement(COMMIT_WINDOW_STATUS_ID);
            return;
        }
        const count = this.model.entries.length;
        this.statusBar.setElement(COMMIT_WINDOW_STATUS_ID, {
            text: `$(git-commit) ${count}`, alignment: StatusBarAlignment.LEFT, priority: 995, className: 'ingot-status-commit-window',
            tooltip: `Open Commit window (${count} change${count === 1 ? '' : 's'}) · ⌥⇧⌘K`, command: COMMIT_COMMANDS.popOut.id
        });
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(COMMIT_COMMANDS.popOut, {
            execute: () => this.window.isOpen ? this.window.close() : this.window.open()
        });
        registry.registerCommand(COMMIT_COMMANDS.aiMessage, {
            execute: async () => {
                if (this.window.isOpen) {
                    this.window.ai.toggle();
                    return;
                }
                await registry.executeCommand(COMMIT_COMMANDS.commit.id);
                this.widgets.tryGetWidget<LocalChangesWidget>(LOCAL_CHANGES_WIDGET_ID)?.ai.toggle();
            }
        });
    }

    registerKeybindings(keybindings: KeybindingRegistry): void {
        keybindings.registerKeybinding({ command: COMMIT_COMMANDS.popOut.id, keybinding: 'ctrlcmd+alt+shift+k' });
    }
}
