import * as React from '@theia/core/shared/react';
import { injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MCP_WIDGET_ID } from './tool-windows.consts';

/** MCP tool window shell; the catalog, setup and status arrive with IDEA-62. */
@injectable()
export class IngotMcpWidget extends ReactWidget {

    @postConstruct()
    protected init(): void {
        this.id = MCP_WIDGET_ID;
        this.title.label = 'MCP Servers';
        this.title.caption = 'MCP Servers';
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-plug';
        this.addClass('ingot-toolwindow');
        this.node.tabIndex = 0;
        this.update();
    }

    protected render(): React.ReactNode {
        return <div className='ingot-tw'>
            <div className='ingot-tw-header'><span className='ingot-tw-title'>MCP Servers</span></div>
            <div className='ingot-tw-empty' id='ingot-mcp-empty'>
                No MCP servers yet. The server catalog (GitHub, Jira, Slack, Postgres and more) with one-click setup is coming next.
            </div>
        </div>;
    }
}
