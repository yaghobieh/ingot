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

type RunKind = 'run' | 'debug';

/** Run / Debug the project's default run configuration (its dev/start npm script) like a full IDE (IDEA-24). */
@injectable()
export class IngotRunContribution implements CommandContribution {

    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FileService) protected readonly files: FileService;
    @inject(TerminalService) protected readonly terminals: TerminalService;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(MessageService) protected readonly messages: MessageService;

    protected session?: TerminalWidget;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(INGOT_RUN_COMMANDS.run, { execute: () => this.start('run') });
        registry.registerCommand(INGOT_RUN_COMMANDS.debug, { execute: () => this.start('debug') });
        registry.registerCommand(INGOT_RUN_COMMANDS.stop, { execute: () => this.stop(), isEnabled: () => !!this.session && !this.session.isDisposed });
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

    protected async start(kind: RunKind): Promise<void> {
        const target = await this.script();
        if (!target) {
            this.messages.info('No run configuration: add a "dev" or "start" script to package.json, or run a task.');
            return;
        }
        // Like classic IDE single-instance run configurations: rerunning stops the previous process.
        this.stop();
        this.session?.dispose();
        const title = `${kind === 'run' ? 'Run' : 'Debug'}: ${target.script}`;
        const terminal = await this.terminals.newTerminal({ title, cwd: target.root, destroyTermOnClose: true, useServerTitle: false });
        await terminal.start();
        this.terminals.open(terminal, { widgetOptions: { area: 'bottom' }, mode: 'activate' });
        this.shell.expandPanel('bottom');
        terminal.sendText(`${runCommandLine(target.script, kind === 'debug')}\r`);
        this.session = terminal;
        if (kind === 'debug') {
            this.messages.info(`Started "${target.script}" with the Node inspector (--inspect). Attach from the Debug tool window (Alt+5).`);
        }
    }

    protected stop(): void {
        if (this.session && !this.session.isDisposed) {
            this.session.sendText('\x03');
        }
    }
}
