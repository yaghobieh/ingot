import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common/command';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { OpenerService, open } from '@theia/core/lib/browser/opener-service';
import URI from '@theia/core/lib/common/uri';
import type { McpServerConfig } from '../../common/project-config/project-config.types';
import {
    ATTENTION_PREVIEW, CUSTOMIZE_TABS, MCP_CATALOG, catalogEntryFor, catalogToConfig, isValidServerName, matchesQuery, rowGroup, rowSummary,
    type CustomizeTab, type McpCatalogEntry, type McpScope
} from '../../common/mcp/mcp-catalog';
import { IngotMcpClient } from '../project-config/mcp-client';
import { MCP_WIDGET_ID } from './tool-windows.consts';

type ScopeFilter = 'all' | McpScope;
interface AddForm { entry: McpCatalogEntry; name: string; scope: McpScope; values: Record<string, string>; error?: string; busy?: boolean }
interface AuthForm { server: string; values: Record<string, string>; busy?: boolean }
interface FileItem { name: string; uri: URI }

const STORE_COMMAND = 'ingot.store.open';

/**
 * Plugins & MCP page (IDEA-62): search, scope selector, kind tabs, "Needs Attention" / "Connected" / "Disabled"
 * sections, a catalog (marketplace) with one-click add, keychain-backed secrets and per-server tools.
 */
@injectable()
export class IngotMcpWidget extends ReactWidget {

    @inject(IngotMcpClient) protected readonly mcp: IngotMcpClient;
    @inject(CommandService) protected readonly commands: CommandService;
    @inject(FileService) protected readonly files: FileService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(OpenerService) protected readonly opener: OpenerService;

    protected query = '';
    protected tab: CustomizeTab = 'mcps';
    protected scope: ScopeFilter = 'all';
    protected showAllAttention = false;
    protected marketplace = false;
    protected expanded = new Set<string>();
    protected output = new Set<string>();
    protected addForm?: AddForm;
    protected authForm?: AuthForm;
    protected tabFiles: FileItem[] = [];

    @postConstruct()
    protected init(): void {
        this.id = MCP_WIDGET_ID;
        this.title.label = 'Plugins & MCP';
        this.title.caption = 'Plugins, MCP servers, skills and rules';
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-plug';
        this.addClass('ingot-toolwindow');
        this.addClass('ingot-mcp-page');
        this.node.tabIndex = 0;
        this.toDispose.push(this.mcp.onDidChange(() => this.update()));
        this.update();
    }

    /** Sets one UI state field and re-renders. */
    protected set(key: 'query' | 'scope' | 'showAllAttention' | 'marketplace' | 'addForm' | 'authForm', value: unknown): void {
        (this as unknown as Record<string, unknown>)[key] = value;
        this.update();
    }

    protected async selectTab(tab: CustomizeTab): Promise<void> {
        this.tab = tab;
        this.marketplace = false;
        this.tabFiles = [];
        this.update();
        const dir = CUSTOMIZE_TABS.find(t => t.id === tab && 'dir' in t) as { dir: string } | undefined;
        const root = this.workspace.tryGetRoots()[0]?.resource;
        if (dir && root) {
            const stat = await this.files.resolve(root.resolve('.ingot').resolve(dir.dir)).catch(() => undefined);
            this.tabFiles = (stat?.children ?? []).filter(c => !c.isDirectory || tab === 'skills').map(c => ({ name: c.name, uri: c.resource }))
                .sort((a, b) => a.name.localeCompare(b.name));
            this.update();
        }
    }

    protected visibleServers(): McpServerConfig[] {
        return this.mcp.servers.filter(s => (this.scope === 'all' || this.mcp.scopeOf(s.name) === this.scope)
            && matchesQuery(this.query, s.name, catalogEntryFor(s)?.name, s.command));
    }

    protected render(): React.ReactNode {
        return <div className='ingot-mcp'>
            <div className='ingot-mcp-top'>
                <label className='ingot-mcp-search'>
                    <span className='codicon codicon-search' />
                    <input id='ingot-mcp-search' type='search' placeholder='Search Plugins, Skills, MCPs…' value={this.query} onChange={e => this.set('query', e.currentTarget.value)} />
                </label>
                <button id='ingot-mcp-browse' type='button' className={`ingot-mcp-browse ${this.marketplace ? 'active' : ''}`}
                    onClick={() => { this.tab = 'mcps'; this.set('marketplace', !this.marketplace); }}>Browse Marketplace</button>
            </div>
            <div className='ingot-mcp-filters'>
                <label className='ingot-mcp-account' title='Show servers from'>
                    <span className='codicon codicon-account' />
                    <select id='ingot-mcp-scope' value={this.scope} onChange={e => this.set('scope', e.currentTarget.value as ScopeFilter)}>
                        <option value='all'>All scopes</option>
                        <option value='user'>User (all projects)</option>
                        <option value='project'>This project</option>
                    </select>
                </label>
                <span className='ingot-mcp-divider' />
                <div className='ingot-mcp-pills' role='tablist'>
                    {CUSTOMIZE_TABS.map(t => <button key={t.id} id={`ingot-mcp-tab-${t.id}`} type='button' role='tab' aria-selected={this.tab === t.id}
                        className={`ingot-mcp-pill ${this.tab === t.id ? 'active' : ''}`} onClick={() => this.selectTab(t.id)}>{t.label}</button>)}
                </div>
                <button type='button' className='ingot-mcp-filter codicon codicon-filter' title='Reload servers' onClick={() => this.mcp.refresh()} />
            </div>
            <div className='ingot-mcp-body'>
                {this.addForm ? this.renderAddForm(this.addForm) : this.marketplace ? this.renderMarketplace() : this.tab === 'mcps' ? this.renderServers() : this.renderFilesTab()}
            </div>
        </div>;
    }

    protected renderServers(): React.ReactNode {
        const servers = this.visibleServers();
        const group = (s: McpServerConfig) => rowGroup(this.mcp.isEnabled(s.name), this.mcp.statusOf(s.name));
        const attention = servers.filter(s => group(s) === 'attention');
        const connected = servers.filter(s => group(s) === 'connected');
        const disabled = servers.filter(s => group(s) === 'available');
        if (!this.mcp.servers.length) {
            return <div className='ingot-mcp-empty' id='ingot-mcp-empty'>
                <p>No MCP servers yet.</p>
                <button type='button' className='ingot-mcp-primary' onClick={() => this.set('marketplace', true)}>Browse Marketplace</button>
            </div>;
        }
        const shownAttention = this.showAllAttention ? attention : attention.slice(0, ATTENTION_PREVIEW);
        return <>
            {attention.length > 0 && <section className='ingot-mcp-section' id='ingot-mcp-attention'>
                <h3>Needs Attention <span>{attention.length}</span></h3>
                <div className='ingot-mcp-list'>{shownAttention.map(s => this.renderRow(s))}</div>
                {attention.length > ATTENTION_PREVIEW && <button type='button' className='ingot-mcp-more' onClick={() => this.set('showAllAttention', !this.showAllAttention)}>
                    {this.showAllAttention ? 'Show less' : `Show ${attention.length - ATTENTION_PREVIEW} more`} <span className={`codicon codicon-chevron-${this.showAllAttention ? 'up' : 'down'}`} />
                </button>}
            </section>}
            {connected.length > 0 && <section className='ingot-mcp-section' id='ingot-mcp-connected'>
                <h3>Connected <span>{connected.length}</span></h3>
                <div className='ingot-mcp-list'>{connected.map(s => this.renderRow(s))}</div>
            </section>}
            {disabled.length > 0 && <section className='ingot-mcp-section' id='ingot-mcp-disabled'>
                <h3>Disabled <span>{disabled.length}</span></h3>
                <div className='ingot-mcp-list'>{disabled.map(s => this.renderRow(s))}</div>
            </section>}
            {!servers.length && <div className='ingot-mcp-empty'>No servers match.</div>}
        </>;
    }

    protected renderIcon(config: { name: string; command?: string; args?: readonly string[] }, dot?: string): React.ReactNode {
        const entry = config.command ? catalogEntryFor({ name: config.name, command: config.command, args: [...(config.args ?? [])] }) : MCP_CATALOG.find(e => e.id === config.name);
        return <span className='ingot-mcp-icon' style={entry ? { background: entry.color } : undefined}>
            {entry ? <span className='ingot-mcp-mark'>{entry.mark}</span> : <span className='codicon codicon-plug' />}
            {dot && <span className={`ingot-mcp-dot ${dot}`} />}
        </span>;
    }

    protected renderRow(server: McpServerConfig): React.ReactNode {
        const enabled = this.mcp.isEnabled(server.name);
        const status = this.mcp.statusOf(server.name);
        const scope = this.mcp.scopeOf(server.name);
        const dot = !enabled ? 'off' : status?.state === 'connected' ? 'ok' : status?.state === 'starting' || !status ? 'busy' : 'bad';
        const open = this.expanded.has(server.name);
        const toggle = (set: Set<string>) => { if (set.has(server.name)) { set.delete(server.name); } else { set.add(server.name); } this.update(); };
        return <div key={server.name} className={`ingot-mcp-row ${open ? 'open' : ''}`} data-server={server.name}>
            <div className='ingot-mcp-row-main' onClick={() => toggle(this.expanded)}>
                {this.renderIcon(server, dot)}
                <div className='ingot-mcp-row-text'>
                    <div><span className='ingot-mcp-name'>{server.name}</span> <span className='ingot-mcp-badge'>{scope === 'user' ? 'User' : 'Project'}</span></div>
                    <div className='ingot-mcp-summary'>
                        {status?.state === 'error'
                            ? <>Error - <a href='#' className='ingot-mcp-output-link' onClick={e => { e.preventDefault(); e.stopPropagation(); toggle(this.output); }}>Show Output</a></>
                            : rowSummary(enabled, status)}
                    </div>
                </div>
                <div className='ingot-mcp-row-actions' onClick={e => e.stopPropagation()}>
                    {enabled && status?.state === 'needs-auth' && <button type='button' className='ingot-mcp-link'
                        onClick={() => this.set('authForm', { server: server.name, values: {} })}>Authenticate</button>}
                    <label className='ingot-switch' title={enabled ? 'Disable' : 'Enable'}>
                        <input type='checkbox' className='ingot-mcp-toggle' checked={enabled} onChange={e => this.mcp.setEnabled(server.name, e.currentTarget.checked)} />
                        <span />
                    </label>
                </div>
            </div>
            {this.authForm?.server === server.name && this.renderAuth(server, this.authForm)}
            {this.output.has(server.name) && <pre className='ingot-mcp-output'>{status?.output || status?.error || 'No output.'}</pre>}
            {open && <div className='ingot-mcp-details'>
                <div className='ingot-mcp-kv'><span>Command</span><code>{[server.command, ...(server.args ?? [])].join(' ')}</code></div>
                <div className='ingot-mcp-kv'><span>Scope</span>{scope === 'user' ? 'User: runs in every project' : 'Project: .ingot/mcp.json, trusted for this project'}</div>
                {!!server.secretEnv?.length && <div className='ingot-mcp-kv'><span>Secrets</span>{server.secretEnv.join(', ')} <em>(OS keychain)</em></div>}
                {!!status?.tools.length && <div className='ingot-mcp-tools'>
                    <div className='ingot-mcp-tools-title'>Tools</div>
                    {status.tools.map(t => <div key={t.name} className='ingot-mcp-tool'><code>{t.name}</code><span>{t.description}</span></div>)}
                </div>}
                <div className='ingot-mcp-detail-actions'>
                    <button type='button' className='ingot-mcp-secondary' onClick={() => toggle(this.output)}>{this.output.has(server.name) ? 'Hide Output' : 'Show Output'}</button>
                    {!!server.secretEnv?.length && <button type='button' className='ingot-mcp-secondary' onClick={() => this.set('authForm', { server: server.name, values: {} })}>Update secrets…</button>}
                    <button type='button' className='ingot-mcp-danger ingot-mcp-remove' onClick={() => this.mcp.removeServer(server.name)}>Remove</button>
                </div>
            </div>}
        </div>;
    }

    protected renderAuth(server: McpServerConfig, form: AuthForm): React.ReactNode {
        const names = this.mcp.statusOf(server.name)?.missingSecrets?.length ? this.mcp.statusOf(server.name)!.missingSecrets! : server.secretEnv ?? [];
        const entry = catalogEntryFor(server);
        return <form className='ingot-mcp-auth' onClick={e => e.stopPropagation()} onSubmit={async e => {
            e.preventDefault();
            this.set('authForm', { ...form, busy: true });
            await this.mcp.authenticate(server.name, form.values);
            this.set('authForm', undefined);
        }}>
            <p>Secrets are stored in the OS keychain, never in files.</p>
            {names.map(n => <label key={n} className='ingot-mcp-field'>
                <span>{entry?.fields.find(f => f.name === n)?.label ?? n}</span>
                <input type='password' autoComplete='off' name={n} value={form.values[n] ?? ''} onChange={e => this.set('authForm', { ...form, values: { ...form.values, [n]: e.currentTarget.value } })} />
            </label>)}
            <div className='ingot-mcp-form-actions'>
                <button type='button' className='ingot-mcp-secondary' onClick={() => this.set('authForm', undefined)}>Cancel</button>
                <button type='submit' className='ingot-mcp-primary' disabled={form.busy}>Save &amp; Connect</button>
            </div>
        </form>;
    }

    protected renderMarketplace(): React.ReactNode {
        const entries = MCP_CATALOG.filter(e => matchesQuery(this.query, e.name, e.description, e.id));
        return <section className='ingot-mcp-section' id='ingot-mcp-marketplace'>
            <h3>MCP Marketplace <span>{entries.length}</span></h3>
            <div className='ingot-mcp-cards'>
                {entries.map(e => {
                    const added = this.mcp.servers.some(s => s.name === e.id || catalogEntryFor(s)?.id === e.id);
                    return <div key={e.id} className='ingot-mcp-card' data-entry={e.id}>
                        <div className='ingot-mcp-card-head'>{this.renderIcon({ name: e.id })}<span className='ingot-mcp-name'>{e.name}</span></div>
                        <p>{e.description}</p>
                        <div className='ingot-mcp-card-foot'>
                            <span className='ingot-mcp-card-meta'>{e.signIn ? 'Browser sign-in' : e.fields.some(f => f.secret) ? 'Needs a token' : 'No setup'}</span>
                            <button type='button' className='ingot-mcp-primary ingot-mcp-add' disabled={added} onClick={() => this.startAdd(e)}>{added ? 'Added' : 'Add'}</button>
                        </div>
                    </div>;
                })}
            </div>
        </section>;
    }

    protected startAdd(entry: McpCatalogEntry): void {
        if (!entry.fields.length) {
            void this.add({ entry, name: entry.id, scope: 'user', values: {} });
            return;
        }
        this.set('addForm', { entry, name: entry.id, scope: 'user', values: {} });
    }

    protected async add(form: AddForm): Promise<void> {
        if (!isValidServerName(form.name)) {
            this.set('addForm', { ...form, error: 'Use letters, digits, dot, dash or underscore.' });
            return;
        }
        const missing = form.entry.fields.find(f => !f.optional && !form.values[f.name]?.trim());
        if (missing) {
            this.set('addForm', { ...form, error: `${missing.label} is required.` });
            return;
        }
        this.set('addForm', { ...form, busy: true, error: undefined });
        try {
            const secrets = Object.fromEntries(form.entry.fields.filter(f => f.secret).map(f => [f.name, form.values[f.name] ?? '']));
            await this.mcp.addServer(catalogToConfig(form.entry, form.name, form.scope, form.values), form.scope, secrets);
            this.addForm = undefined;
            this.marketplace = false;
            this.update();
        } catch (error) {
            this.set('addForm', { ...form, busy: false, error: error instanceof Error ? error.message : String(error) });
        }
    }

    protected renderAddForm(form: AddForm): React.ReactNode {
        const update = (patch: Partial<AddForm>) => this.set('addForm', { ...form, ...patch, error: undefined });
        return <form className='ingot-mcp-addform' id='ingot-mcp-addform' onSubmit={e => { e.preventDefault(); void this.add(form); }}>
            <div className='ingot-mcp-card-head'>{this.renderIcon({ name: form.entry.id })}<h3>Add {form.entry.name}</h3></div>
            <p className='ingot-mcp-hint'>{form.entry.description}</p>
            <label className='ingot-mcp-field'><span>Name</span><input name='name' value={form.name} onChange={e => update({ name: e.currentTarget.value })} /></label>
            <label className='ingot-mcp-field'><span>Enable for</span>
                <select name='scope' value={form.scope} onChange={e => update({ scope: e.currentTarget.value as McpScope })}>
                    <option value='user'>All projects (user)</option>
                    <option value='project'>This project only</option>
                </select>
            </label>
            {form.entry.fields.map(f => <label key={f.name} className='ingot-mcp-field'>
                <span>{f.label}{f.secret && <em> · stored in OS keychain</em>}</span>
                <input name={f.name} type={f.secret ? 'password' : 'text'} autoComplete='off' placeholder={f.placeholder} value={form.values[f.name] ?? ''}
                    onChange={e => update({ values: { ...form.values, [f.name]: e.currentTarget.value } })} />
            </label>)}
            {form.error && <div className='ingot-mcp-error'>{form.error}</div>}
            <div className='ingot-mcp-form-actions'>
                <button type='button' className='ingot-mcp-secondary' onClick={() => this.set('addForm', undefined)}>Cancel</button>
                <button type='submit' className='ingot-mcp-primary' disabled={form.busy}>{form.busy ? 'Adding…' : 'Add server'}</button>
            </div>
        </form>;
    }

    protected renderFilesTab(): React.ReactNode {
        const tab = CUSTOMIZE_TABS.find(t => t.id === this.tab)!;
        if (this.tab === 'plugins') {
            return <div className='ingot-mcp-empty' id='ingot-mcp-plugins'>
                <p>Plugins, themes and terminal skins are installed from the Ingot Store.</p>
                <button type='button' className='ingot-mcp-primary' onClick={() => this.commands.executeCommand(STORE_COMMAND).catch(() => undefined)}>Open Store</button>
            </div>;
        }
        const items = this.tabFiles.filter(f => matchesQuery(this.query, f.name));
        const dir = 'dir' in tab ? `.ingot/${tab.dir}/` : '';
        return <section className='ingot-mcp-section' id={`ingot-mcp-files-${tab.id}`}>
            <h3>{tab.label} <span>{items.length}</span></h3>
            {items.length ? <div className='ingot-mcp-list'>{items.map(f => <div key={f.name} className='ingot-mcp-row'>
                <div className='ingot-mcp-row-main' onClick={() => open(this.opener, f.uri)}>
                    <span className='ingot-mcp-icon'><span className='codicon codicon-file' /></span>
                    <div className='ingot-mcp-row-text'><span className='ingot-mcp-name'>{f.name}</span><div className='ingot-mcp-summary'>{dir}{f.name}</div></div>
                </div>
            </div>)}</div> : <div className='ingot-mcp-empty'>No {tab.label.toLowerCase()} yet. Add files to <code>{dir}</code> in this project.</div>}
        </section>;
    }
}
