import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ApplicationShell } from '@theia/core/lib/browser/shell/application-shell';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { TerminalService } from '@theia/terminal/lib/browser/base/terminal-service';
import type { TerminalWidget } from '@theia/terminal/lib/browser/base/terminal-widget';
import { CommandRegistry } from '@theia/core/lib/common/command';
import type { RunScript } from '../../common/tool-windows/tool-windows.types';
import { parseRunScripts } from '../../common/tool-windows/tool-windows.utils';
import { PORTS_TOGGLE_COMMAND } from '../ports/ingot-ports.consts';
import { SERVICES_WIDGET_ID } from './tool-windows.consts';

/** Services tool window: the project's npm scripts to start, and running terminals to focus or stop (IDEA-61). */
@injectable()
export class IngotServicesWidget extends ReactWidget {

    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FileService) protected readonly files: FileService;
    @inject(TerminalService) protected readonly terminals: TerminalService;
    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;

    protected scripts: RunScript[] = [];

    @postConstruct()
    protected init(): void {
        this.id = SERVICES_WIDGET_ID;
        this.title.label = 'Services';
        this.title.caption = 'Services';
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-server-process';
        this.addClass('ingot-toolwindow');
        this.node.tabIndex = 0;
        this.toDispose.push(this.workspace.onWorkspaceChanged(() => this.loadScripts()));
        this.toDispose.push(this.terminals.onDidCreateTerminal(t => {
            t.onDidDispose(() => this.update());
            t.title.changed.connect(() => this.update());
            this.update();
        }));
        this.terminals.all.forEach(t => t.onDidDispose(() => this.update()));
        this.loadScripts();
    }

    protected async loadScripts(): Promise<void> {
        const [root] = this.workspace.tryGetRoots();
        const json = root ? await this.files.read(root.resource.resolve('package.json')).then(c => c.value).catch(() => '') : '';
        this.scripts = parseRunScripts(json);
        this.update();
    }

    protected async start(script: RunScript): Promise<void> {
        const [root] = this.workspace.tryGetRoots();
        if (!root) {
            return;
        }
        const terminal = await this.terminals.newTerminal({ title: `npm: ${script.name}`, cwd: root.resource.toString(), destroyTermOnClose: true, useServerTitle: false });
        await terminal.start();
        this.terminals.open(terminal, { widgetOptions: { area: 'bottom' }, mode: 'reveal' });
        terminal.sendText(`npm run ${script.name}\r`);
        this.update();
    }

    protected focus(terminal: TerminalWidget): void {
        this.terminals.open(terminal, { widgetOptions: { area: 'bottom' }, mode: 'activate' });
        this.shell.expandPanel('bottom');
    }

    protected render(): React.ReactNode {
        const running = this.terminals.all.filter(t => !t.isDisposed);
        return <div className='ingot-tw'>
            <div className='ingot-tw-header'>
                <span className='ingot-tw-title'>Services</span>
                <button type='button' className='ingot-tw-icon-button' title='Ports' aria-label='Show ports' onClick={() => this.commands.executeCommand(PORTS_TOGGLE_COMMAND.id)}>
                    <span className='codicon codicon-plug' />
                </button>
            </div>
            <div className='ingot-tw-section'>Running</div>
            {!running.length && <div className='ingot-tw-empty'>Nothing running.</div>}
            <ul className='ingot-tw-list' id='ingot-services-running'>
                {running.map(t => (
                    <li key={t.id} className='ingot-tw-row'>
                        <span className='codicon codicon-circle-filled ingot-tw-live' />
                        <button type='button' className='ingot-tw-name ingot-tw-link' onClick={() => this.focus(t)}>{t.title.label}</button>
                        <button type='button' className='ingot-tw-icon-button' title='Stop (Ctrl+C)' aria-label={`Stop ${t.title.label}`} onClick={() => t.sendText('\x03')}>
                            <span className='codicon codicon-debug-stop' />
                        </button>
                    </li>
                ))}
            </ul>
            <div className='ingot-tw-section'>Scripts</div>
            {!this.scripts.length && <div className='ingot-tw-empty'>No package.json scripts.</div>}
            <ul className='ingot-tw-list' id='ingot-services-scripts'>
                {this.scripts.map(s => (
                    <li key={s.name} className='ingot-tw-row' title={s.command}>
                        <button type='button' className='ingot-tw-icon-button' title={`Run ${s.name}`} aria-label={`Run ${s.name}`} onClick={() => this.start(s)}>
                            <span className='codicon codicon-play' />
                        </button>
                        <span className='ingot-tw-name'>{s.name}</span>
                        <span className='ingot-tw-detail'>{s.command}</span>
                    </li>
                ))}
            </ul>
        </div>;
    }
}
