import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { FrontendApplicationContribution, KeybindingContribution, KeybindingRegistry } from '@theia/core/lib/browser';
import { isOSX } from '@theia/core/lib/common/os';
import { WorkspaceCommands } from '@theia/workspace/lib/browser/workspace-commands';
import { IngotGroupService } from './ingot-group-service';
import { GROUP_COMMANDS } from '../../common/groups/groups.consts';

@injectable()
export class IngotGroupsContribution implements FrontendApplicationContribution, CommandContribution, KeybindingContribution {

    @inject(IngotGroupService) protected readonly groups: IngotGroupService;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;

    onDidInitializeLayout(): Promise<void> {
        return this.groups.start();
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(GROUP_COMMANDS.newGroup, { execute: () => this.groups.createGroup() });
        registry.registerCommand(GROUP_COMMANDS.addProject, {
            execute: () => this.commands.executeCommand(WorkspaceCommands.ADD_FOLDER.id),
            isEnabled: () => this.groups.isGroup
        });
        registry.registerCommand(GROUP_COMMANDS.removeProject, {
            execute: () => this.groups.active && this.groups.removeProject(this.groups.active.uri),
            isEnabled: () => this.groups.isGroup && this.groups.projects.length > 1
        });
        registry.registerCommand(GROUP_COMMANDS.nextProject, { execute: () => this.groups.cycle(1), isEnabled: () => this.groups.isGroup });
        registry.registerCommand(GROUP_COMMANDS.previousProject, { execute: () => this.groups.cycle(-1), isEnabled: () => this.groups.isGroup });
    }

    /** IntelliJ: Next/Previous Project Window (Ctrl+Alt+] / Ctrl+Alt+[, Cmd+` / Cmd+Shift+` on macOS). */
    registerKeybindings(keybindings: KeybindingRegistry): void {
        const [next, previous] = isOSX ? ['cmd+`', 'cmd+shift+`'] : ['ctrl+alt+]', 'ctrl+alt+['];
        keybindings.registerKeybinding({ command: GROUP_COMMANDS.nextProject.id, keybinding: next });
        keybindings.registerKeybinding({ command: GROUP_COMMANDS.previousProject.id, keybinding: previous });
    }
}
