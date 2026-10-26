import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { QuickInputService, type QuickPickItem } from '@theia/core/lib/common/quick-pick-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { ProcessStore } from './process-store';
import { PROCESS_COMMANDS } from './processes.browser-consts';
import { scriptCommand } from '../../common/processes/processes.utils';

const COMMAND_ITEM_ID = 'ingot-processes-custom';

/** IDEA-132: Run Script or Command… (from the chat's process list), Stop All, Show Processes in Chat. */
@injectable()
export class ProcessesContribution implements CommandContribution {

    @inject(ProcessStore) protected readonly store: ProcessStore;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(PROCESS_COMMANDS.run, { execute: () => this.run() });
        registry.registerCommand(PROCESS_COMMANDS.stopAll, { execute: () => this.stopAll(), isEnabled: () => this.store.running.length > 0 });
        registry.registerCommand(PROCESS_COMMANDS.toggle, { execute: () => this.store.setPinned(!this.store.pinned) });
    }

    protected get root(): string | undefined {
        return this.workspace.tryGetRoots()[0]?.resource.path.fsPath();
    }

    /** Pick a package.json script (or type any command); it runs in the background as one of the user's processes. */
    async run(): Promise<void> {
        const cwd = this.root;
        if (!cwd) {
            return;
        }
        const found = await this.store.service.scripts(cwd).catch(() => undefined);
        const items: (QuickPickItem & { command?: string })[] = [
            ...Object.entries(found?.scripts ?? {}).map(([name, body]) => ({ id: `script:${name}`, label: name, description: body, command: scriptCommand(found!.manager, name) })),
            { id: COMMAND_ITEM_ID, label: '$(terminal) Run a command…', description: 'Any shell command in the project root' }
        ];
        const picked = await this.quickInput.showQuickPick(items, { title: found ? `Run a script (${found.manager}) or a command` : 'Run a command', matchOnDescription: true });
        if (!picked) {
            return;
        }
        const command = picked.id === COMMAND_ITEM_ID
            ? (await this.quickInput.input({ prompt: 'Command to run in the project root', placeHolder: 'npm run dev' }))?.trim()
            : picked.command;
        if (command) {
            this.store.setPinned(true);
            await this.store.service.start({ cwd, command, origin: 'user', background: true });
        }
    }

    async stopAll(): Promise<void> {
        await Promise.all(this.store.running.map(p => this.store.service.stop(p.id)));
    }
}
