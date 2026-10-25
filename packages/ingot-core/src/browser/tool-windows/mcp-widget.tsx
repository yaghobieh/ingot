import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { CommandService } from '@theia/core/lib/common/command';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { OpenerService, open } from '@theia/core/lib/browser/opener-service';
import URI from '@theia/core/lib/common/uri';
import type { ConfigSource, McpServerConfig, ProjectConfig } from '../../common/project-config/project-config.types';
import { CONFIG_DIRS, HOOKS_DIR, SUBAGENTS_DIR } from '../../common/project-config/project-config.consts';
import { scopeLabel, slugify } from '../../common/project-config/project-config.utils';
import {
    ATTENTION_PREVIEW, CUSTOMIZE_TABS, EMPTY_SERVER_FORM, MCP_CATALOG, catalogEntryFor, catalogToConfig, configToForm, customToConfig, isValidServerName,
    matchesQuery, newItemFile, rowGroup, rowSummary,
    type ConfigItemKind, type CustomServerForm, type CustomizeTab, type McpCatalogEntry, type McpKeyValue, type McpScope
} from '../../common/mcp/mcp-catalog';
import { IngotMcpClient } from '../project-config/mcp-client';
import { IngotFeatureFlags } from '../config/feature-flags';
import { IDE_FLAGS } from '../../common/config/remote-config.consts';
import { ProjectConfigService } from '../project-config/project-config-service';
import { MCP_WIDGET_ID } from './tool-windows.consts';

type ScopeFilter = 'all' | McpScope;
interface AddForm { entry: McpCatalogEntry; name: string; scope: McpScope; values: Record<string, string>; error?: string; busy?: boolean }
interface ServerDialog { previous?: string; form: CustomServerForm; scope: McpScope; error?: string; busy?: boolean }
interface AuthForm { server: string; values: Record<string, string>; busy?: boolean }
interface NewItem { kind: ConfigItemKind; name: string; scope: McpScope; error?: string }
interface ListItem { key: string; name: string; detail: string; source: ConfigSource | 'user'; uri?: string; extra?: string }

const STORE_COMMAND = 'ingot.store.open';
const KIND_OF_TAB: Partial<Record<CustomizeTab, ConfigItemKind>> = { rules: 'rule', commands: 'command', skills: 'skill', subagents: 'subagent', hooks: 'hook' };
const KIND_LABEL: Record<ConfigItemKind, string> = { rule: 'Rule', command: 'Command', skill: 'Skill', subagent: 'Subagent', hook: 'Hook' };

/**
 * Rules & MCP page (IDEA-62): search, scope selector, kind pills, MCP servers grouped into "Needs Attention" /
 * "Connected" / "Disabled" with per-tool toggles, Add / Edit MCP Server (stdio or HTTP, OAuth), a marketplace,
 * and Rules / Commands / Skills / Subagents / Hooks from the project `.ingot/` and the global `~/.ingot/`.
 * Secrets go to the OS keychain; config files only hold `${keychain}` placeholders.
 */
@injectable()
export class IngotMcpWidget extends ReactWidget {

    @inject(IngotMcpClient) protected readonly mcp: IngotMcpClient;
    @inject(IngotFeatureFlags) protected readonly flags: IngotFeatureFlags;
    @inject(ProjectConfigService) protected readonly configService: ProjectConfigService;
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
    protected serverDialog?: ServerDialog;
    protected authForm?: AuthForm;
    protected newItem?: NewItem;
    protected config?: ProjectConfig;
    protected plainFiles: ListItem[] = [];

    @postConstruct()
    protected init(): void {
        this.id = MCP_WIDGET_ID;
        this.title.label = 'Rules & MCP';
        this.title.caption = 'Plugins, MCP servers, skills, rules and commands';
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-plug';
        // The marketplace can be switched off remotely (IDEA-125).
        this.toDispose.push(this.flags.onDidChange(() => {
            if (!this.flags.enabled(IDE_FLAGS.mcpMarketplace)) {
                this.marketplace = false;
            }
            this.update();
        }));
        this.addClass('ingot-toolwindow');
        this.addClass('ingot-mcp-page');
        this.node.tabIndex = 0;
        this.toDispose.push(this.mcp.onDidChange(() => this.update()));
        this.update();
    }

    /** Sets one UI state field and re-renders. */
    protected set(key: 'query' | 'scope' | 'showAllAttention' | 'marketplace' | 'addForm' | 'authForm' | 'serverDialog' | 'newItem', value: unknown): void {
        (this as unknown as Record<string, unknown>)[key] = value;
        this.update();
    }

    protected get root(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    async selectTab(tab: CustomizeTab): Promise<void> {
        this.tab = tab;
        this.marketplace = false;
        this.newItem = undefined;
        this.update();
        await this.reloadItems();
    }

    protected async reloadItems(): Promise<void> {
        const kind = KIND_OF_TAB[this.tab];
        if (kind === 'subagent' || kind === 'hook') {
            const files = await this.configService.listFiles(this.root, kind === 'subagent' ? SUBAGENTS_DIR : HOOKS_DIR);
            this.plainFiles = files.map(f => ({ key: f.uri.toString(), name: f.name, detail: `${f.source === 'global' ? '~/' : ''}${CONFIG_DIRS.ingot}/${kind === 'subagent' ? SUBAGENTS_DIR : HOOKS_DIR}/${f.name}`, source: f.source, uri: f.uri.toString() }));
        } else if (kind) {
            this.config = await this.configService.load(this.root);
        }
        this.update();
    }

    protected scopeOk(source: ConfigSource | 'user'): boolean {
        const label = scopeLabel(source);
        return this.scope === 'all' || (this.scope === 'user' ? label !== 'Project' : label === 'Project');
    }

    protected visibleServers(): McpServerConfig[] {
        return this.mcp.servers.filter(s => this.scopeOk(s.source) && matchesQuery(this.query, s.name, catalogEntryFor(s)?.name, s.command, s.url));
    }

    protected render(): React.ReactNode {
        return <div className='ingot-mcp'>
            <div className='ingot-mcp-top'>
                <label className='ingot-mcp-search'>
                    <span className='codicon codicon-search' />
                    <input id='ingot-mcp-search' type='search' placeholder='Search Plugins, Skills, MCPs…' value={this.query} onChange={e => this.set('query', e.currentTarget.value)} />
                </label>
                {this.flags.enabled(IDE_FLAGS.mcpMarketplace) && <button id='ingot-mcp-browse' type='button' className={`ingot-mcp-browse ${this.marketplace ? 'active' : ''}`}
                    onClick={() => { this.tab = 'mcps'; this.serverDialog = undefined; this.addForm = undefined; this.set('marketplace', !this.marketplace); }}>Browse Marketplace</button>}
            </div>
            <div className='ingot-mcp-filters'>
                <label className='ingot-mcp-account' title='Show items from'>
                    <span className='codicon codicon-account' />
                    <select id='ingot-mcp-scope' value={this.scope} onChange={e => this.set('scope', e.currentTarget.value as ScopeFilter)}>
                        <option value='all'>All scopes</option>
                        <option value='user'>Global (~/.ingot)</option>
                        <option value='project'>This project</option>
                    </select>
                </label>
                <span className='ingot-mcp-divider' />
                <div className='ingot-mcp-pills' role='tablist'>
                    {CUSTOMIZE_TABS.map(t => <button key={t.id} id={`ingot-mcp-tab-${t.id}`} type='button' role='tab' aria-selected={this.tab === t.id}
                        className={`ingot-mcp-pill ${this.tab === t.id ? 'active' : ''}`} onClick={() => this.selectTab(t.id)}>{t.label}</button>)}
                </div>
                <button type='button' id='ingot-mcp-reload' className='ingot-mcp-filter codicon codicon-refresh' title='Reload' onClick={() => this.tab === 'mcps' ? this.mcp.refresh() : this.reloadItems()} />
            </div>
            <div className='ingot-mcp-body'>{this.renderBody()}</div>
        </div>;
    }

    protected renderBody(): React.ReactNode {
        if (this.addForm) {
            return this.renderAddForm(this.addForm);
        }
        if (this.serverDialog) {
            return this.renderServerDialog(this.serverDialog);
        }
        if (this.marketplace && this.flags.enabled(IDE_FLAGS.mcpMarketplace)) {
            return this.renderMarketplace();
        }
        if (this.tab === 'mcps') {
            return this.renderServers();
        }
        if (this.tab === 'plugins') {
            return <div className='ingot-mcp-empty' id='ingot-mcp-plugins'>
                <p>Plugins, themes and terminal skins are installed from the Ingot Store.</p>
                <button type='button' className='ingot-mcp-primary' onClick={() => this.commands.executeCommand(STORE_COMMAND).catch(() => undefined)}>Open Store</button>
            </div>;
        }
        return this.renderItems(KIND_OF_TAB[this.tab]!);
    }

    // ---- MCP servers ----

    protected openServerDialog(server?: McpServerConfig): void {
        const scope = server ? (this.mcp.scopeOf(server.name) === 'project' ? 'project' : 'user') : 'user';
        this.marketplace = false;
        this.set('serverDialog', { previous: server && this.mcp.scopeOf(server.name) !== 'imported' ? server.name : undefined, form: server ? configToForm(server) : EMPTY_SERVER_FORM, scope });
    }

    protected renderServers(): React.ReactNode {
        const servers = this.visibleServers();
        const group = (s: McpServerConfig) => rowGroup(this.mcp.isEnabled(s.name), this.mcp.statusOf(s.name));
        const attention = servers.filter(s => group(s) === 'attention');
        const connected = servers.filter(s => group(s) === 'connected');
        const disabled = servers.filter(s => group(s) === 'available');
        const shownAttention = this.showAllAttention ? attention : attention.slice(0, ATTENTION_PREVIEW);
        return <>
            <div className='ingot-mcp-toolbar'>
                <button type='button' id='ingot-mcp-add-server' className='ingot-mcp-secondary' onClick={() => this.openServerDialog()}><span className='codicon codicon-add' /> Add MCP Server</button>
            </div>
            {!this.mcp.servers.length && <div className='ingot-mcp-empty' id='ingot-mcp-empty'>
                <p>No MCP servers yet. Add one, or pick a popular app from the marketplace.</p>
                <button type='button' className='ingot-mcp-primary' onClick={() => this.set('marketplace', true)}>Browse Marketplace</button>
            </div>}
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
            {!!this.mcp.servers.length && !servers.length && <div className='ingot-mcp-empty'>No servers match.</div>}
        </>;
    }

    protected renderIcon(config: { name: string; command?: string; args?: readonly string[] }, dot?: string): React.ReactNode {
        const entry = config.command ? catalogEntryFor({ name: config.name, command: config.command, args: [...(config.args ?? [])] }) : MCP_CATALOG.find(e => e.id === config.name);
        return <span className='ingot-mcp-icon' style={entry ? { background: entry.color } : undefined}>
            {entry ? <span className='ingot-mcp-mark'>{entry.mark}</span> : <span className='codicon codicon-plug' />}
            {dot && <span className={`ingot-mcp-dot ${dot}`} />}
        </span>;
    }

    protected toggleIn(set: Set<string>, name: string): void {
        if (set.has(name)) {
            set.delete(name);
        } else {
            set.add(name);
        }
        this.update();
    }

    protected async confirm(title: string, msg: string, ok: string): Promise<boolean> {
        return !!await new ConfirmDialog({ title, msg, ok, cancel: 'Cancel' }).open();
    }

    protected async remove(server: McpServerConfig): Promise<void> {
        if (await this.confirm('Remove MCP Server', `Remove "${server.name}" and delete its keychain secrets?`, 'Remove')) {
            await this.mcp.removeServer(server.name);
        }
    }

    protected renderRow(server: McpServerConfig): React.ReactNode {
        const enabled = this.mcp.isEnabled(server.name);
        const status = this.mcp.statusOf(server.name);
        const scope = this.mcp.scopeOf(server.name);
        const dot = !enabled ? 'off' : status?.state === 'connected' ? 'ok' : status?.state === 'starting' || !status ? 'busy' : 'bad';
        const open = this.expanded.has(server.name);
        const tools = status?.tools ?? [];
        const onTools = tools.filter(t => this.mcp.isToolEnabled(server.name, t.name)).length;
        const summary = status?.state === 'connected' && onTools !== tools.length
            ? `${onTools} of ${tools.length} tools${status.resources ? `, ${status.resources} resources` : ''} enabled`
            : rowSummary(enabled, status);
        return <div key={server.name} className={`ingot-mcp-row ${open ? 'open' : ''}`} data-server={server.name} id={`ingot-mcp-row-${server.name}`}>
            <div className='ingot-mcp-row-main' onClick={() => this.toggleIn(this.expanded, server.name)}>
                {this.renderIcon(server, dot)}
                <div className='ingot-mcp-row-text'>
                    <div><span className='ingot-mcp-name'>{server.name}</span> <span className='ingot-mcp-badge'>{scopeLabel(server.source)}</span>
                        {this.mcp.isProjectDisabled(server.name) && <span className='ingot-mcp-badge'>Off in this project</span>}</div>
                    <div className='ingot-mcp-summary'>
                        {status?.state === 'error'
                            ? <>Error - <a href='#' className='ingot-mcp-output-link' onClick={e => { e.preventDefault(); e.stopPropagation(); this.toggleIn(this.output, server.name); }}>Show Output</a></>
                            : summary}
                    </div>
                </div>
                <div className='ingot-mcp-row-actions' onClick={e => e.stopPropagation()}>
                    {enabled && status?.state === 'needs-auth' && <button type='button' className='ingot-mcp-link ingot-mcp-authenticate'
                        onClick={() => this.set('authForm', { server: server.name, values: {} })}>Authenticate</button>}
                    <label className='ingot-switch' title={enabled ? 'Disable' : 'Enable'}>
                        <input type='checkbox' className='ingot-mcp-toggle' checked={enabled} onChange={e => this.mcp.setEnabled(server.name, e.currentTarget.checked)} />
                        <span />
                    </label>
                </div>
            </div>
            {this.authForm?.server === server.name && this.renderAuth(server, this.authForm)}
            {this.output.has(server.name) && <div className='ingot-mcp-drawer'>
                <div className='ingot-mcp-drawer-head'>Output · {server.name}<button type='button' className='codicon codicon-close' title='Close' onClick={() => this.toggleIn(this.output, server.name)} /></div>
                <pre className='ingot-mcp-output'>{status?.output || status?.error || 'No output.'}</pre>
            </div>}
            {open && <div className='ingot-mcp-details'>
                <div className='ingot-mcp-kv'><span>{server.url ? 'URL' : 'Command'}</span><code>{server.url ?? [server.command, ...(server.args ?? [])].join(' ')}</code></div>
                <div className='ingot-mcp-kv'><span>Scope</span>{scope === 'user' ? 'Global: ~/.ingot/mcp.json, runs in every project' : scope === 'imported' ? 'Imported (read-only), off until enabled' : 'Project: trusted for this project only'}</div>
                {!!Object.keys(server.env ?? {}).length && <div className='ingot-mcp-kv'><span>Env</span>{Object.keys(server.env ?? {}).join(', ')} <em>(values hidden)</em></div>}
                {!!(server.secretEnv?.length || server.secretHeaders?.length) && <div className='ingot-mcp-kv'><span>Secrets</span>{[...(server.secretEnv ?? []), ...(server.secretHeaders ?? [])].join(', ')} <em>(OS keychain)</em></div>}
                {scope === 'user' && <label className='ingot-mcp-check'><input type='checkbox' className='ingot-mcp-project-off' checked={this.mcp.isProjectDisabled(server.name)}
                    onChange={e => this.mcp.setProjectDisabled(server.name, e.currentTarget.checked)} /> Turn off in this project only</label>}
                {!!tools.length && <div className='ingot-mcp-tools'>
                    <div className='ingot-mcp-tools-title'>Tools <span>{onTools}/{tools.length}</span></div>
                    {tools.map(t => <label key={t.name} className='ingot-mcp-tool'>
                        <input type='checkbox' className='ingot-mcp-tool-toggle' data-tool={t.name} checked={this.mcp.isToolEnabled(server.name, t.name)}
                            onChange={e => this.mcp.setToolEnabled(server.name, t.name, e.currentTarget.checked)} />
                        <code>{t.name}</code><span>{t.description}</span>
                    </label>)}
                </div>}
                <div className='ingot-mcp-detail-actions'>
                    <button type='button' className='ingot-mcp-secondary ingot-mcp-show-output' onClick={() => this.toggleIn(this.output, server.name)}>{this.output.has(server.name) ? 'Hide Output' : 'Show Output'}</button>
                    <button type='button' className='ingot-mcp-secondary ingot-mcp-restart' disabled={!enabled} onClick={() => this.mcp.restart(server.name)}>Restart</button>
                    <button type='button' className='ingot-mcp-secondary ingot-mcp-edit' onClick={() => this.openServerDialog(server)}>{scope === 'imported' ? 'Copy to Ingot…' : 'Edit…'}</button>
                    {scope !== 'imported' && <button type='button' className='ingot-mcp-danger ingot-mcp-remove' onClick={() => this.remove(server)}>Remove</button>}
                </div>
            </div>}
        </div>;
    }

    protected renderAuth(server: McpServerConfig, form: AuthForm): React.ReactNode {
        const status = this.mcp.statusOf(server.name);
        const names = status?.missingSecrets?.length ? status.missingSecrets : [...(server.secretEnv ?? []), ...(server.secretHeaders ?? []).map(h => `header:${h}`)];
        const entry = catalogEntryFor(server);
        return <form className='ingot-mcp-auth' onClick={e => e.stopPropagation()} onSubmit={async e => {
            e.preventDefault();
            this.set('authForm', { ...form, busy: true });
            await this.mcp.authenticate(server.name, form.values);
            this.set('authForm', undefined);
        }}>
            <p>Secrets are stored in the OS keychain, never in files.</p>
            {names.map(n => <label key={n} className='ingot-mcp-field'>
                <span>{entry?.fields.find(f => f.name === n)?.label ?? n.replace(/^header:/, 'Header ')}</span>
                <input type='password' autoComplete='off' name={n} value={form.values[n] ?? ''} onChange={e => this.set('authForm', { ...form, values: { ...form.values, [n]: e.currentTarget.value } })} />
            </label>)}
            <div className='ingot-mcp-form-actions'>
                <button type='button' className='ingot-mcp-secondary' onClick={() => this.set('authForm', undefined)}>Cancel</button>
                <button type='submit' className='ingot-mcp-primary' disabled={form.busy}>Save &amp; Connect</button>
            </div>
        </form>;
    }

    protected renderKeyValues(label: string, list: readonly McpKeyValue[], onChange: (list: McpKeyValue[]) => void, kind: string): React.ReactNode {
        const set = (i: number, patch: Partial<McpKeyValue>) => onChange(list.map((kv, j) => j === i ? { ...kv, ...patch } : kv));
        return <div className='ingot-mcp-kvlist' data-kind={kind}>
            <div className='ingot-mcp-kvlist-head'>{label}<button type='button' className='ingot-mcp-link ingot-mcp-kv-add' onClick={() => onChange([...list, { key: '', value: '', secret: false }])}>+ Add</button></div>
            {list.map((kv, i) => <div key={i} className='ingot-mcp-kvrow'>
                <input className='ingot-mcp-kv-key' placeholder='NAME' value={kv.key} onChange={e => set(i, { key: e.currentTarget.value })} />
                <input className='ingot-mcp-kv-value' type={kv.secret ? 'password' : 'text'} autoComplete='off' placeholder={kv.secret && !kv.value ? 'stored in keychain' : 'value'} value={kv.value} onChange={e => set(i, { value: e.currentTarget.value })} />
                <label className='ingot-mcp-check' title='Store the value in the OS keychain'><input type='checkbox' className='ingot-mcp-kv-secret' checked={kv.secret} onChange={e => set(i, { secret: e.currentTarget.checked })} /> Secret</label>
                <button type='button' className='codicon codicon-trash' title='Remove' onClick={() => onChange(list.filter((_, j) => j !== i))} />
            </div>)}
        </div>;
    }

    protected async saveServer(dialog: ServerDialog): Promise<void> {
        const { form } = dialog;
        const error = !isValidServerName(form.name) ? 'Name: letters, digits, dot, dash or underscore.'
            : form.transport === 'stdio' && !form.command.trim() ? 'Command is required.'
            : form.transport === 'http' && !/^https?:\/\//.test(form.url.trim()) ? 'URL must start with http:// or https://.'
            : dialog.previous !== form.name && this.mcp.servers.some(s => s.name === form.name && this.mcp.scopeOf(s.name) !== 'imported') ? `A server named "${form.name}" already exists.` : undefined;
        if (error) {
            this.set('serverDialog', { ...dialog, error });
            return;
        }
        this.set('serverDialog', { ...dialog, busy: true, error: undefined });
        try {
            const { config, secrets } = customToConfig(form, dialog.scope);
            await this.mcp.updateServer(dialog.previous ?? form.name, config, dialog.scope, secrets);
            this.set('serverDialog', undefined);
        } catch (e) {
            this.set('serverDialog', { ...dialog, busy: false, error: e instanceof Error ? e.message : String(e) });
        }
    }

    protected renderServerDialog(dialog: ServerDialog): React.ReactNode {
        const { form } = dialog;
        const update = (patch: Partial<CustomServerForm>) => this.set('serverDialog', { ...dialog, form: { ...form, ...patch }, error: undefined });
        return <form className='ingot-mcp-addform' id='ingot-mcp-server-dialog' onSubmit={e => { e.preventDefault(); void this.saveServer(dialog); }}>
            <h3>{dialog.previous ? `Edit ${dialog.previous}` : 'Add MCP Server'}</h3>
            <label className='ingot-mcp-field'><span>Name</span><input name='name' value={form.name} placeholder='my-server' onChange={e => update({ name: e.currentTarget.value })} /></label>
            <div className='ingot-mcp-segmented' role='radiogroup'>
                {(['stdio', 'http'] as const).map(t => <button key={t} type='button' role='radio' aria-checked={form.transport === t} id={`ingot-mcp-transport-${t}`}
                    className={form.transport === t ? 'active' : ''} onClick={() => update({ transport: t })}>{t === 'stdio' ? 'Local command (stdio)' : 'Remote URL (HTTP / SSE)'}</button>)}
            </div>
            {form.transport === 'stdio' ? <>
                <label className='ingot-mcp-field'><span>Command</span><input name='command' value={form.command} placeholder='npx' onChange={e => update({ command: e.currentTarget.value })} /></label>
                <label className='ingot-mcp-field'><span>Arguments</span><input name='args' value={form.args} placeholder='-y @scope/server --flag "value with spaces"' onChange={e => update({ args: e.currentTarget.value })} /></label>
            </> : <>
                <label className='ingot-mcp-field'><span>URL</span><input name='url' value={form.url} placeholder='https://example.com/mcp' onChange={e => update({ url: e.currentTarget.value })} /></label>
                <label className='ingot-mcp-check'><input type='checkbox' name='oauth' checked={form.oauth} onChange={e => update({ oauth: e.currentTarget.checked })} /> Sign in with OAuth in the browser</label>
                {!form.oauth && this.renderKeyValues('Headers', form.headers, headers => update({ headers }), 'headers')}
            </>}
            {(form.transport === 'stdio' || form.oauth) && this.renderKeyValues('Environment', form.env, env => update({ env }), 'env')}
            <label className='ingot-mcp-field'><span>Enable for</span>
                <select name='scope' value={dialog.scope} onChange={e => this.set('serverDialog', { ...dialog, scope: e.currentTarget.value as McpScope })}>
                    <option value='user'>All projects (global ~/.ingot/mcp.json)</option>
                    <option value='project'>This project only (.ingot/mcp.json)</option>
                </select>
            </label>
            <p className='ingot-mcp-hint'>Values marked Secret are saved in the OS keychain; mcp.json only gets a placeholder.</p>
            {dialog.error && <div className='ingot-mcp-error'>{dialog.error}</div>}
            <div className='ingot-mcp-form-actions'>
                <button type='button' className='ingot-mcp-secondary' onClick={() => this.set('serverDialog', undefined)}>Cancel</button>
                <button type='submit' className='ingot-mcp-primary' disabled={dialog.busy}>{dialog.busy ? 'Saving…' : dialog.previous ? 'Save' : 'Add server'}</button>
            </div>
        </form>;
    }

    // ---- Marketplace ----

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
            <p className='ingot-mcp-hint'>{form.entry.description}{form.entry.signIn ? ' A browser window opens to sign in the first time it starts.' : ''}</p>
            <label className='ingot-mcp-field'><span>Name</span><input name='name' value={form.name} onChange={e => update({ name: e.currentTarget.value })} /></label>
            <label className='ingot-mcp-field'><span>Enable for</span>
                <select name='scope' value={form.scope} onChange={e => update({ scope: e.currentTarget.value as McpScope })}>
                    <option value='user'>All projects (global)</option>
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

    // ---- Rules / Commands / Skills / Subagents / Hooks ----

    protected itemsFor(kind: ConfigItemKind): ListItem[] {
        if (kind === 'subagent' || kind === 'hook') {
            return this.plainFiles;
        }
        if (kind === 'rule') {
            return (this.config?.rules ?? []).map(r => ({ key: r.path, name: r.name, detail: r.path, source: r.source, uri: r.uri, extra: r.alwaysApply ? 'always' : r.globs.join(', ') }));
        }
        return (this.config?.commands ?? []).filter(c => c.kind === kind).map(c => ({ key: c.path, name: kind === 'command' ? `/${c.name}` : c.name, detail: c.description ?? c.path, source: c.source, uri: c.uri }));
    }

    protected async createItem(item: NewItem): Promise<void> {
        const slug = slugify(item.name);
        if (!slug) {
            this.set('newItem', { ...item, error: 'Enter a name.' });
            return;
        }
        const base = item.scope === 'user' ? await this.configService.globalDir() : this.root?.resolve(CONFIG_DIRS.ingot);
        if (!base) {
            this.set('newItem', { ...item, error: 'Open a project first, or create it globally.' });
            return;
        }
        const { path, content } = newItemFile(item.kind, slug);
        const uri = path.reduce((u, p) => u.resolve(p), base);
        if (await this.files.exists(uri)) {
            this.set('newItem', { ...item, error: `${path.join('/')} already exists.` });
            return;
        }
        await this.files.create(uri, content);
        this.newItem = undefined;
        await this.reloadItems();
        await open(this.opener, uri);
    }

    protected async deleteItem(item: ListItem, kind: ConfigItemKind): Promise<void> {
        if (!item.uri || !await this.confirm(`Delete ${KIND_LABEL[kind]}`, `Delete ${item.detail}? This removes the file.`, 'Delete')) {
            return;
        }
        const uri = new URI(item.uri);
        await this.files.delete(kind === 'skill' ? uri.parent : uri, { recursive: true, useTrash: true }).catch(() => this.files.delete(kind === 'skill' ? uri.parent : uri, { recursive: true }));
        await this.reloadItems();
    }

    protected renderItems(kind: ConfigItemKind): React.ReactNode {
        if (!this.config && kind !== 'subagent' && kind !== 'hook') {
            void this.reloadItems();
        }
        const items = this.itemsFor(kind).filter(i => this.scopeOk(i.source) && matchesQuery(this.query, i.name, i.detail));
        const label = KIND_LABEL[kind];
        const item = this.newItem;
        return <section className='ingot-mcp-section' id={`ingot-mcp-items-${kind}`}>
            <div className='ingot-mcp-section-head'>
                <h3>{CUSTOMIZE_TABS.find(t => t.id === this.tab)?.label} <span>{items.length}</span></h3>
                <button type='button' id={`ingot-mcp-new-${kind}`} className='ingot-mcp-secondary' onClick={() => this.set('newItem', { kind, name: '', scope: this.root ? 'project' : 'user' })}>
                    <span className='codicon codicon-add' /> New {label}
                </button>
            </div>
            {item?.kind === kind && <form className='ingot-mcp-newitem' id='ingot-mcp-newitem' onSubmit={e => { e.preventDefault(); void this.createItem(item); }}>
                <input name='name' autoFocus placeholder={`${label} name`} value={item.name} onChange={e => this.set('newItem', { ...item, name: e.currentTarget.value, error: undefined })} />
                <select name='scope' value={item.scope} onChange={e => this.set('newItem', { ...item, scope: e.currentTarget.value as McpScope })}>
                    <option value='project'>Project (.ingot)</option>
                    <option value='user'>Global (~/.ingot)</option>
                </select>
                <button type='submit' className='ingot-mcp-primary'>Create</button>
                <button type='button' className='ingot-mcp-secondary' onClick={() => this.set('newItem', undefined)}>Cancel</button>
                {item.error && <div className='ingot-mcp-error'>{item.error}</div>}
            </form>}
            {items.length ? <div className='ingot-mcp-list'>{items.map(i => <div key={i.key} className='ingot-mcp-row ingot-mcp-item' data-item={i.name}>
                <div className='ingot-mcp-row-main' onClick={() => i.uri && open(this.opener, new URI(i.uri))}>
                    <span className='ingot-mcp-icon'><span className={`codicon codicon-${kind === 'rule' ? 'law' : kind === 'skill' ? 'mortar-board' : kind === 'subagent' ? 'hubot' : kind === 'hook' ? 'zap' : 'terminal'}`} /></span>
                    <div className='ingot-mcp-row-text'>
                        <div><span className='ingot-mcp-name'>{i.name}</span> <span className='ingot-mcp-badge ingot-mcp-scope'>{scopeLabel(i.source)}</span>{i.extra && <span className='ingot-mcp-badge'>{i.extra}</span>}</div>
                        <div className='ingot-mcp-summary'>{i.detail}</div>
                    </div>
                    <div className='ingot-mcp-row-actions' onClick={e => e.stopPropagation()}>
                        {i.uri && <button type='button' className='codicon codicon-edit' title='Edit' onClick={() => open(this.opener, new URI(i.uri!))} />}
                        {i.uri && scopeLabel(i.source) !== 'Imported' && <button type='button' className='codicon codicon-trash ingot-mcp-item-delete' title='Delete' onClick={() => this.deleteItem(i, kind)} />}
                    </div>
                </div>
            </div>)}</div> : <div className='ingot-mcp-empty'>No {label.toLowerCase()}s yet. Project ones live in <code>.ingot/</code>, global ones in <code>~/.ingot/</code>.</div>}
        </section>;
    }
}
