import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { ApplicationShell } from '@theia/core/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import type { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { INGOT_RUN_COMMANDS } from '../../common/keymap/ingot.keymap.consts';
import { pickRunScript } from '../../common/vcs/vcs.utils';
import { runCommandLine } from '../../common/vcs/run.utils';
import { IngotDebugLauncher } from '../debug/ingot-debug-launcher';

/**
 * Run / Debug like a full IDE (IDEA-24, IDEA-138): Run starts the project's dev/start npm script in a terminal
 * (or the selected run/debug configuration without the debugger); Debug starts a real debug session.
 */
@injectable()
export class IngotRunContribution implements CommandContribution {

    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FileService) protected readonly files: FileService;
    @inject(TerminalService) protected readonly terminals: TerminalService;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(IngotDebugLauncher) protected readonly debugLauncher: IngotDebugLauncher;

    protected session?: TerminalWidget;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(INGOT_RUN_COMMANDS.run, { execute: () => this.runSelected() });
        registry.registerCommand(INGOT_RUN_COMMANDS.debug, { execute: () => this.debugLauncher.launch() });
        registry.registerCommand(INGOT_RUN_COMMANDS.stop, { execute: () => this.stopAll(), isEnabled: () => this.terminalAlive || this.debugLauncher.sessionActive });
    }

    protected async script(): Promise<{ root: string; script: string } | undefined> {
        const [root] = this.workspace.tryGetRoots();
        if (!root) {
            return undefined;
        }
        try {
            const script = pickRunScript((await this.files.read(root.resource.resolve('package.json'))).value);
            return script ? { root: root.resource.toString(), script } : undefined;
        } catch {
            return undefined;
        }
    }

    protected get terminalAlive(): boolean {
        return !!this.session && !this.session.isDisposed;
    }

    /** A selected launch configuration runs without the debugger; otherwise the npm script runs in a terminal. */
    protected async runSelected(): Promise<void> {
        if (this.debugLauncher.explicitName) {
            await this.debugLauncher.launch(true);
            return;
        }
        const target = await this.script();
        if (!target) {
            if (this.debugLauncher.hasConfiguration) {
                await this.debugLauncher.launch(true);
            } else {
                this.messages.info('No run configuration: add a "dev" or "start" script to package.json, or create a run/debug configuration.');
            }
            return;
        }
        // Like classic IDE single-instance run configurations: rerunning stops the previous process.
        this.stop();
        this.session?.dispose();
        const title = `Run: ${target.script}`;
        const terminal = await this.terminals.newTerminal({ title, cwd: target.root, destroyTermOnClose: true, useServerTitle: false });
        await terminal.start();
        this.terminals.open(terminal, { widgetOptions: { area: 'bottom' }, mode: 'activate' });
        this.shell.expandPanel('bottom');
        terminal.sendText(`${runCommandLine(target.script, false)}\r`);
        this.session = terminal;
    }

    protected async stopAll(): Promise<void> {
        this.stop();
        if (this.debugLauncher.sessionActive) {
            await this.debugLauncher.stop();
        }
    }

    protected stop(): void {
        if (this.session && !this.session.isDisposed) {
            this.session.sendText('\x03');
        }
    }
}
