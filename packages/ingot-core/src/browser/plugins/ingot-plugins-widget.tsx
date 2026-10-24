import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { CommandService } from '@theia/core/lib/common/command';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import { VSXExtensionsModel } from '@theia/vsx-registry/lib/browser/vsx-extensions-model';
import type { VSXExtension } from '@theia/vsx-registry/lib/browser/vsx-extension';
import { VSXExtensionsCommands } from '@theia/vsx-registry/lib/browser/vsx-extension-commands';
import { OPEN_VSX_PUBLISH_DOCS, PLUGIN_CATEGORIES, type PluginsTab } from '../../common/plugins/plugins.consts';
import { formatDownloads, pluginKinds, unversionedId } from '../../common/plugins/plugins.utils';
import { PLUGINS_INSTALL_FOLDER_COMMAND, PLUGINS_WIDGET_ID, PLUGINS_WIDGET_LABEL, SEARCH_DEBOUNCE_MS } from './plugins.browser-consts';

interface PluginContributes { readonly themes?: unknown[]; readonly iconThemes?: unknown[] }

/** JetBrains-style Plugins page on top of Open VSX (IDEA-37): Marketplace / Installed, search, install, enable/disable, uninstall. */
@injectable()
export class IngotPluginsWidget extends ReactWidget {

    @inject(VSXExtensionsModel) protected readonly model: VSXExtensionsModel;
    @inject(CommandService) protected readonly commands: CommandService;
    @inject(WindowService) protected readonly windowService: WindowService;

    protected tab: PluginsTab = 'marketplace';
    protected query = '';
    protected showBuiltins = false;
    protected searchTimer: ReturnType<typeof setTimeout> | undefined;
    protected needsReload = false;

    @postConstruct()
    protected init(): void {
        this.id = PLUGINS_WIDGET_ID;
        this.title.label = PLUGINS_WIDGET_LABEL;
        this.title.caption = PLUGINS_WIDGET_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-extensions';
        this.addClass('ingot-plugins-widget');
        this.toDispose.push(this.model.onDidChange(() => this.update()));
        this.update();
    }

    protected search(text: string): void {
        this.query = text;
        this.update();
        clearTimeout(this.searchTimer);
        this.searchTimer = setTimeout(() => { this.model.search.query = text.trim(); }, SEARCH_DEBOUNCE_MS);
    }

    protected marketplace(): VSXExtension[] {
        if (!this.query.trim()) {
            return [];
        }
        return [...this.model.searchResult].map(id => this.model.getExtension(id)).filter((e): e is VSXExtension => !!e);
    }

    protected installed(): VSXExtension[] {
        const needle = this.query.trim().toLowerCase();
        const seen = new Set<string>();
        const result: VSXExtension[] = [];
        for (const id of this.model.installed) {
            const plain = unversionedId(id);
            const ext = this.model.getExtension(plain) ?? this.model.getExtension(id);
            if (!ext || seen.has(ext.id) || (ext.builtin && !this.showBuiltins)) {
                continue;
            }
            seen.add(ext.id);
            if (!needle || `${ext.displayName ?? ''} ${ext.id} ${ext.description ?? ''}`.toLowerCase().includes(needle)) {
                result.push(ext);
            }
        }
        return result.sort((a, b) => (a.displayName ?? a.id).localeCompare(b.displayName ?? b.id));
    }

    protected async run(ext: VSXExtension, action: 'install' | 'uninstall' | 'enable' | 'disable'): Promise<void> {
        await ext[action]();
        if (action === 'disable' || action === 'enable') {
            this.needsReload = true;
        }
        this.update();
    }

    protected render(): React.ReactNode {
        const list = this.tab === 'marketplace' ? this.marketplace() : this.installed();
        return <div className='ingot-plugins'>
            <div className='ingot-plugins-header'>
                <div className='ingot-plugins-tabs' role='tablist'>
                    {(['marketplace', 'installed'] as const).map(tab =>
                        <button key={tab} id={`ingot-plugins-tab-${tab}`} role='tab' aria-selected={this.tab === tab}
                            className={`ingot-plugins-tab${this.tab === tab ? ' active' : ''}`}
                            onClick={() => { this.tab = tab; this.update(); }}>{tab === 'marketplace' ? 'Marketplace' : 'Installed'}</button>)}
                </div>
                <div className='ingot-plugins-tools'>
                    <button id='ingot-plugins-install-vsix' className='theia-button secondary' title='Install a .vsix file'
                        onClick={() => this.commands.executeCommand(VSXExtensionsCommands.INSTALL_FROM_VSIX.id)}>Install from Disk…</button>
                    <button id='ingot-plugins-install-folder' className='theia-button secondary' title='Developers: install an unpacked plugin folder'
                        onClick={() => this.commands.executeCommand(PLUGINS_INSTALL_FOLDER_COMMAND.id)}>Install from Folder…</button>
                </div>
            </div>
            <input id='ingot-plugins-search' className='theia-input ingot-plugins-search' spellCheck={false}
                placeholder={this.tab === 'marketplace' ? 'Search Open VSX plugins, themes and extensions' : 'Filter installed plugins'}
                value={this.query} onChange={e => this.search(e.currentTarget.value)} />
            {this.tab === 'marketplace' && <div className='ingot-plugins-categories'>
                {PLUGIN_CATEGORIES.map(c => <button key={c.id} id={`ingot-plugins-category-${c.id}`} className='ingot-plugins-chip' onClick={() => this.search(c.query)}>{c.label}</button>)}
            </div>}
            {this.tab === 'installed' && <label className='ingot-plugins-builtins'>
                <input id='ingot-plugins-show-builtins' type='checkbox' checked={this.showBuiltins} onChange={e => { this.showBuiltins = e.currentTarget.checked; this.update(); }} /> Show built-in
            </label>}
            {this.needsReload && <div className='ingot-plugins-reload' id='ingot-plugins-reload'>
                Some changes apply after a reload. <a href='#' onClick={e => { e.preventDefault(); this.windowService.reload(); }}>Reload now</a>
            </div>}
            {this.model.searchError && this.tab === 'marketplace' && <div className='ingot-plugins-error'>Open VSX is unreachable: {this.model.searchError}</div>}
            <div className='ingot-plugins-list' id='ingot-plugins-list'>
                {list.map(ext => this.renderRow(ext))}
                {!list.length && <div className='ingot-plugins-empty'>{this.emptyText()}</div>}
            </div>
            <div className='ingot-plugins-footer'>
                Build your own: package a VS Code extension or color theme, then install it from a folder or .vsix, or <a href={OPEN_VSX_PUBLISH_DOCS} target='_blank' rel='noreferrer'>publish it to Open VSX</a>.
            </div>
        </div>;
    }

    protected emptyText(): string {
        if (this.tab === 'installed') {
            return this.query ? 'No installed plugins match.' : 'No plugins installed yet.';
        }
        return this.query.trim() ? 'Searching Open VSX…' : 'Search Open VSX or pick a category.';
    }

    protected renderRow(ext: VSXExtension): React.ReactNode {
        const contributes = (ext.plugin?.metadata.model as { contributes?: PluginContributes } | undefined)?.contributes;
        const kinds = pluginKinds(contributes ? { themes: contributes.themes?.length ?? 0, iconThemes: contributes.iconThemes?.length ?? 0 } : undefined);
        const busy = ext.currentTask;
        return <div key={ext.id} className={`ingot-plugin-row${ext.disabled ? ' disabled' : ''}`} data-id={ext.id}>
            {ext.iconUrl ? <img className='ingot-plugin-icon' src={ext.iconUrl} alt='' /> : <span className='ingot-plugin-icon codicon codicon-extensions' />}
            <div className='ingot-plugin-main'>
                <div className='ingot-plugin-title'>
                    <span className='ingot-plugin-name'>{ext.displayName ?? ext.name ?? ext.id}</span>
                    {kinds.map(k => <span key={k} className='ingot-plugin-badge'>{k}</span>)}
                    {ext.builtin && <span className='ingot-plugin-badge'>Built-in</span>}
                    {ext.disabled && <span className='ingot-plugin-badge muted'>Disabled</span>}
                </div>
                <div className='ingot-plugin-meta'>{[ext.publisher, ext.installedVersion ?? ext.version, formatDownloads(ext.downloadCount) && `${formatDownloads(ext.downloadCount)} downloads`].filter(Boolean).join(' · ')}</div>
                <div className='ingot-plugin-description'>{ext.description}</div>
            </div>
            <div className='ingot-plugin-actions'>
                {busy && <span className='ingot-plugin-busy'>{busy}…</span>}
                {!busy && this.renderActions(ext)}
                <button className='theia-button secondary ingot-plugin-details' title='Details' onClick={() => ext.open()}>Details</button>
            </div>
        </div>;
    }

    protected renderActions(ext: VSXExtension): React.ReactNode {
        if (!ext.installed) {
            return <button className='theia-button ingot-plugin-install' onClick={() => this.run(ext, 'install')}>Install</button>;
        }
        if (ext.builtin) {
            return <span className='ingot-plugin-installed'>Bundled</span>;
        }
        return <>
            {ext.disabled
                ? <button className='theia-button secondary ingot-plugin-enable' onClick={() => this.run(ext, 'enable')}>Enable</button>
                : <button className='theia-button secondary ingot-plugin-disable' onClick={() => this.run(ext, 'disable')}>Disable</button>}
            <button className='theia-button secondary ingot-plugin-uninstall' onClick={() => this.run(ext, 'uninstall')}>Uninstall</button>
        </>;
    }
}
