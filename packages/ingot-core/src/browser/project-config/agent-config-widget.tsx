import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import type { McpServerConfig, ProjectConfig } from '../../common/project-config/project-config.types';
import { IngotMcpClient } from './mcp-client';
import { ProjectConfigService } from './project-config-service';
import { AGENT_CONFIG_WIDGET_ID, AGENT_CONFIG_WIDGET_LABEL } from './project-config.browser-consts';

const STATE_LABEL = { disabled: 'Disabled', starting: 'Starting…', connected: 'Connected', error: 'Error' } as const;

/** Settings › Rules, Commands & MCP servers for the open project (IDEA-30/31). */
@injectable()
export class IngotAgentConfigWidget extends ReactWidget {

    @inject(IngotMcpClient) protected readonly mcp: IngotMcpClient;
    @inject(ProjectConfigService) protected readonly configService: ProjectConfigService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(EditorManager) protected readonly editors: EditorManager;

    protected config?: ProjectConfig;

    @postConstruct()
    protected init(): void {
        this.id = AGENT_CONFIG_WIDGET_ID;
        this.title.label = AGENT_CONFIG_WIDGET_LABEL;
        this.title.caption = AGENT_CONFIG_WIDGET_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'ingot-icon ingot-icon-ai';
        this.addClass('ingot-models');
        this.toDispose.push(this.mcp.onDidChange(() => this.update()));
        this.reload();
    }

    protected async reload(): Promise<void> {
        const root = this.workspace.tryGetRoots()[0]?.resource;
        this.config = await this.configService.load(root);
        await this.mcp.refresh(root);
        this.update();
    }

    protected open(path: string): void {
        const root = this.workspace.tryGetRoots()[0]?.resource;
        if (root) {
            this.editors.open(root.resolve(path), { mode: 'activate' });
        }
    }

    protected renderServer(server: McpServerConfig): React.ReactNode {
        const status = this.mcp.statusOf(server.name);
        const enabled = this.mcp.isEnabled(server.name);
        const state = enabled ? status?.state ?? 'starting' : 'disabled';
        return <div key={server.name} className='ingot-model-card ingot-mcp-card' id={`ingot-mcp-server-${server.name}`}>
            <div className='ingot-model-head'>
                <span className='ingot-model-name'>{server.name} <span className='ingot-badge'>{server.source}</span></span>
                <label className='ingot-models-row'>
                    <span id={`ingot-mcp-status-${server.name}`} className={`ingot-model-status ${state === 'connected' ? 'ok' : ''}`}>{STATE_LABEL[state]}</span>
                    <input id={`ingot-mcp-toggle-${server.name}`} type='checkbox' checked={enabled} aria-label={`Enable ${server.name}`}
                        onChange={e => this.mcp.setEnabled(server.name, e.currentTarget.checked)} />
                </label>
            </div>
            <div className='ingot-models-row'><span className='ingot-models-label'>{server.url ? 'URL' : 'Command'}</span>
                <code className='ingot-mcp-command'>{server.url ?? [server.command, ...(server.args ?? [])].join(' ')}</code></div>
            {server.env && <div className='ingot-models-row'><span className='ingot-models-label'>Environment</span>
                <span>{Object.keys(server.env).join(', ')} <span className='ingot-models-lead'>(values hidden)</span></span></div>}
            {status?.error && <div className='ingot-model-result error'>{status.error}</div>}
            {status && status.tools.length > 0 && <ul id={`ingot-mcp-tools-${server.name}`} className='ingot-mcp-tools'>
                {status.tools.map(t => <li key={t.name}><code>{t.name}</code> {t.description}</li>)}
            </ul>}
        </div>;
    }

    protected render(): React.ReactNode {
        const config = this.config;
        return <div className='ingot-models-root'>
            <h2>Rules</h2>
            <p className='ingot-models-lead'>From <code>.alloy/rules</code>, <code>.cursor/rules</code>, <code>AGENTS.md</code> and <code>.cursorrules</code>. Rules with globs apply only when a matching file is in the agent's context.</p>
            <ul id='ingot-config-rules' className='ingot-mcp-tools'>
                {config?.rules.map(r => <li key={r.path}><a href='#' onClick={e => { e.preventDefault(); this.open(r.path); }}>{r.name}</a> <span className='ingot-badge'>{r.source}</span> {r.alwaysApply ? 'always' : r.globs.join(', ')}</li>)}
                {config && config.rules.length === 0 && <li className='ingot-models-lead'>No rules yet.</li>}
            </ul>
            <h2>Commands & skills</h2>
            <p className='ingot-models-lead'>Type <code>/</code> in the agent composer. From <code>.alloy/commands</code>, <code>.alloy/skills/*/SKILL.md</code> and <code>.cursor/commands</code>.</p>
            <ul id='ingot-config-commands' className='ingot-mcp-tools'>
                {config?.commands.map(c => <li key={c.path}><code>/{c.name}</code> <span className='ingot-badge'>{c.kind === 'skill' ? 'skill' : c.source}</span> {c.description}</li>)}
                {config && config.commands.length === 0 && <li className='ingot-models-lead'>No commands yet.</li>}
            </ul>
            <h2>MCP servers</h2>
            <p className='ingot-models-lead'>From <code>.alloy/mcp.json</code> and <code>.cursor/mcp.json</code>. A project's servers run commands on your machine, so they stay off until you enable them here.</p>
            <div className='ingot-models-list'>
                {this.mcp.servers.map(s => this.renderServer(s))}
                {this.mcp.servers.length === 0 && <div className='ingot-models-lead'>No MCP servers configured.</div>}
            </div>
            <div className='ingot-models-row' style={{ marginTop: 12 }}>
                <button type='button' id='ingot-config-reload' className='theia-button secondary' onClick={() => this.reload()}>Reload</button>
            </div>
        </div>;
    }
}
