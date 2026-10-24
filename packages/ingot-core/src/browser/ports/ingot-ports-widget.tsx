import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { MessageService } from '@theia/core/lib/common/message-service';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import { PORTS_REFRESH_MS } from '../../common/ports/ports.consts';
import { PortsService, type PortInfo } from '../../common/ports/ports.types';
import { filterPorts, portUrl } from '../../common/ports/ports.utils';
import { PORTS_WIDGET_ID, PORTS_WIDGET_LABEL } from './ingot-ports.consts';

/** Ports tool window: listening TCP ports with process, open in browser and stop (IDEA-24). */
@injectable()
export class IngotPortsWidget extends ReactWidget {

    @inject(PortsService) protected readonly ports: PortsService;
    @inject(WindowService) protected readonly windows: WindowService;
    @inject(MessageService) protected readonly messages: MessageService;

    protected items: PortInfo[] = [];
    protected query = '';
    protected error?: string;
    protected loading = false;
    protected timer?: ReturnType<typeof setInterval>;

    @postConstruct()
    protected init(): void {
        this.id = PORTS_WIDGET_ID;
        this.title.label = PORTS_WIDGET_LABEL;
        this.title.caption = 'Listening ports';
        this.title.closable = true;
        this.title.iconClass = 'ingot-icon ingot-icon-ports';
        this.addClass('ingot-ports');
        this.node.tabIndex = 0;
        this.toDispose.push({ dispose: () => this.stopPolling() });
    }

    protected override onAfterShow(msg: Message): void {
        super.onAfterShow(msg);
        this.refresh();
        this.stopPolling();
        this.timer = setInterval(() => this.refresh(), PORTS_REFRESH_MS);
    }

    protected override onAfterHide(msg: Message): void {
        super.onAfterHide(msg);
        this.stopPolling();
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    protected stopPolling(): void {
        if (this.timer) {
            clearInterval(this.timer);
            this.timer = undefined;
        }
    }

    async refresh(): Promise<void> {
        this.loading = true;
        try {
            this.items = await this.ports.list();
            this.error = undefined;
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
        } finally {
            this.loading = false;
            this.update();
        }
    }

    protected open(info: PortInfo): void {
        this.windows.openNewWindow(portUrl(info), { external: true });
    }

    protected async stop(info: PortInfo): Promise<void> {
        if (!info.pid) {
            return;
        }
        const confirmed = await new ConfirmDialog({
            title: `Stop process on port ${info.port}?`,
            msg: `${info.process ?? 'Process'} (PID ${info.pid}) will be sent SIGTERM.`,
            ok: 'Stop',
            cancel: 'Cancel'
        }).open();
        if (!confirmed) {
            return;
        }
        const result = await this.ports.kill(info.pid);
        if (!result.ok) {
            this.messages.error(`Could not stop PID ${info.pid}: ${result.message ?? 'unknown error'}`);
        }
        setTimeout(() => this.refresh(), 500);
    }

    protected render(): React.ReactNode {
        const rows = filterPorts(this.items, this.query);
        return <div className='ingot-ports-root'>
            <div className='ingot-ports-toolbar'>
                <input className='theia-input ingot-ports-filter' placeholder='Filter by port, process or PID' value={this.query}
                    onChange={e => { this.query = e.currentTarget.value; this.update(); }} />
                <button type='button' className='ingot-ports-iconbtn' title='Refresh' aria-label='Refresh ports' onClick={() => this.refresh()}>
                    <span className={`codicon codicon-refresh ${this.loading ? 'codicon-modifier-spin' : ''}`} />
                </button>
            </div>
            {this.error && <div className='ingot-ports-error'>{this.error}</div>}
            <table className='ingot-ports-table'>
                <thead><tr><th>Port</th><th>Address</th><th>Process</th><th>PID</th><th /></tr></thead>
                <tbody>
                    {rows.map(p => (
                        <tr key={`${p.port}-${p.pid}`} data-port={p.port}>
                            <td className='ingot-ports-port'>{p.port}</td>
                            <td>{p.addresses.join(', ')}</td>
                            <td>{p.process ?? '—'}</td>
                            <td>{p.pid ?? '—'}</td>
                            <td className='ingot-ports-actions'>
                                <button type='button' className='ingot-ports-iconbtn' title='Open in browser' aria-label={`Open port ${p.port} in browser`} onClick={() => this.open(p)}>
                                    <span className='codicon codicon-globe' />
                                </button>
                                <button type='button' className='ingot-ports-iconbtn danger' title='Stop process' aria-label={`Stop process on port ${p.port}`} disabled={!p.pid} onClick={() => this.stop(p)}>
                                    <span className='codicon codicon-debug-stop' />
                                </button>
                            </td>
                        </tr>
                    ))}
                </tbody>
            </table>
            {!rows.length && !this.error && <div className='ingot-ports-empty'>{this.loading ? 'Scanning…' : 'No listening ports.'}</div>}
        </div>;
    }
}
