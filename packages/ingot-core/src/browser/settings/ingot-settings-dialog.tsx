import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactDialog } from '@theia/core/lib/browser/dialogs/react-dialog';
import { DialogProps } from '@theia/core/lib/browser/dialogs';
import type { Message } from '@theia/core/lib/browser/widgets';
import { CommandService } from '@theia/core/lib/common/command';
import { PreferenceSchemaService, PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { ThemeService } from '@theia/core/lib/browser/theming';
import { IconThemeService } from '@theia/core/lib/browser/icon-theme-service';
import { SETTINGS_PREFS, SETTINGS_TREE } from '../../common/settings/settings.consts';
import type { SettingInfo, SettingsAction, SettingsPage } from '../../common/settings/settings.types';
import { coerceSetting, flattenPages, searchPages, settingLabel, visiblePreferences } from '../../common/settings/settings.utils';
import { INLINE_ACTIONS, SETTINGS_ACTION_COMMANDS, SettingsDialogProps, settingDomId } from './settings.browser-consts';

interface Option { readonly value: string; readonly label: string }

/** IDE-style Settings dialog: searchable tree, schema-driven pages, OK / Cancel / Apply (IDEA-34). */
@injectable()
export class IngotSettingsDialog extends ReactDialog<void> {

    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(PreferenceSchemaService) protected readonly schema: PreferenceSchemaService;
    @inject(CommandService) protected readonly commands: CommandService;
    @inject(ThemeService) protected readonly themes: ThemeService;
    @inject(IconThemeService) protected readonly iconThemes: IconThemeService;

    protected query = '';
    protected selected = 'appearance';
    protected collapsed = new Set<string>();
    protected pending = new Map<string, unknown>();
    protected applyButton: HTMLButtonElement;
    protected afterClose: string | undefined;

    constructor(@inject(SettingsDialogProps) props: DialogProps) {
        super(props);
    }

    @postConstruct()
    protected init(): void {
        this.node.classList.add('ingot-settings-dialog');
        this.appendCloseButton('Cancel');
        this.applyButton = this.appendButton('Apply', false);
        this.applyButton.id = 'ingot-settings-apply';
        this.appendAcceptButton('OK');
        this.acceptButton!.id = 'ingot-settings-ok';
        this.closeButton!.id = 'ingot-settings-cancel';
        this.toDispose.push(this.themes.onDidColorThemeChange(() => this.update()));
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        // Listeners added here are disposed on detach, so re-add them for every opening.
        this.addAction(this.applyButton, () => { this.apply(); }, 'click');
    }

    get value(): void {
        return undefined;
    }

    /** Opens fresh (pending edits from a cancelled session are dropped), optionally on a page. */
    async show(pageId?: string): Promise<void> {
        if (this.isAttached) {
            this.activate();
            return;
        }
        this.pending.clear();
        this.query = '';
        this.afterClose = undefined;
        if (pageId) {
            this.selected = pageId;
        }
        this.updateApply();
        await this.open(false);
        const command = this.afterClose;
        if (command) {
            await this.commands.executeCommand(command);
        }
    }

    protected override async accept(): Promise<void> {
        await this.apply();
        return super.accept();
    }

    protected async apply(): Promise<void> {
        const entries = [...this.pending];
        this.pending.clear();
        for (const [key, value] of entries) {
            await this.preferences.set(key, value, PreferenceScope.User);
        }
        this.updateApply();
        this.update();
    }

    protected updateApply(): void {
        if (this.applyButton) {
            this.applyButton.disabled = this.pending.size === 0;
        }
    }

    protected describe = (key: string): SettingInfo | undefined => {
        const property = this.schema.getSchemaProperty(key);
        if (!property) {
            return undefined;
        }
        const description = property.markdownDescription ?? property.description;
        return { key, description: typeof description === 'string' ? description : undefined };
    };

    protected optionsFor(key: string): Option[] | undefined {
        if (key === SETTINGS_PREFS.colorTheme) {
            return this.themes.getThemes().map(t => ({ value: t.id, label: t.label }));
        }
        if (key === SETTINGS_PREFS.iconTheme) {
            return [...this.iconThemes.definitions].map(d => ({ value: d.id, label: d.label ?? d.id }));
        }
        const property = this.schema.getSchemaProperty(key);
        const values = property?.enum as unknown[] | undefined;
        if (!values) {
            return undefined;
        }
        const labels = (property as { enumItemLabels?: string[] }).enumItemLabels;
        return values.map((v, i) => ({ value: String(v), label: labels?.[i] ?? String(v) }));
    }

    protected currentValue(key: string): unknown {
        return this.pending.has(key) ? this.pending.get(key) : this.preferences.get(key);
    }

    protected change(key: string, value: unknown): void {
        if (value === undefined) {
            return;
        }
        this.pending.set(key, value);
        this.updateApply();
        this.update();
    }

    protected runAction(action: SettingsAction): void {
        const command = SETTINGS_ACTION_COMMANDS[action];
        if (INLINE_ACTIONS.has(action)) {
            this.commands.executeCommand(command).then(() => this.update());
            return;
        }
        this.afterClose = command;
        this.accept();
    }

    protected render(): React.ReactNode {
        const visible = searchPages(SETTINGS_TREE, this.query, this.describe);
        const all = flattenPages(SETTINGS_TREE);
        const current = all.find(p => p.page.id === this.selected && visible.has(p.page.id)) ?? all.find(p => visible.has(p.page.id));
        return <div className='ingot-settings' id='ingot-settings'>
            <div className='ingot-settings-side'>
                <input id='ingot-settings-search' className='theia-input' placeholder='Search settings' value={this.query} autoFocus spellCheck={false}
                    onChange={e => { this.query = e.currentTarget.value; this.update(); }} />
                <div className='ingot-settings-tree' role='tree'>{this.renderTree(SETTINGS_TREE, visible, 0, current?.page.id)}</div>
            </div>
            <div className='ingot-settings-page'>
                {current
                    ? <>
                        <div className='ingot-settings-crumbs' id='ingot-settings-crumbs'>{current.path.join(' › ')}</div>
                        {this.renderPage(current.page)}
                    </>
                    : <div className='ingot-settings-empty'>Nothing found.</div>}
            </div>
        </div>;
    }

    protected renderTree(pages: readonly SettingsPage[], visible: Set<string>, depth: number, selected?: string): React.ReactNode {
        return pages.filter(p => visible.has(p.id)).map(page => {
            const open = !this.collapsed.has(page.id) || !!this.query;
            return <React.Fragment key={page.id}>
                <div id={`ingot-settings-node-${page.id}`} role='treeitem' aria-selected={selected === page.id}
                    className={`ingot-settings-node${selected === page.id ? ' selected' : ''}`} style={{ paddingLeft: 8 + depth * 14 }}
                    onClick={() => {
                        if (page.children && selected === page.id) {
                            if (open) {
                                this.collapsed.add(page.id);
                            } else {
                                this.collapsed.delete(page.id);
                            }
                        }
                        this.selected = page.id;
                        this.update();
                    }}>
                    <span className={`codicon ${page.children ? (open ? 'codicon-chevron-down' : 'codicon-chevron-right') : 'codicon-blank'}`} />
                    {page.label}
                </div>
                {page.children && open && this.renderTree(page.children, visible, depth + 1, selected)}
            </React.Fragment>;
        });
    }

    protected renderPage(page: SettingsPage): React.ReactNode {
        const keys = visiblePreferences(page, this.query, this.describe).filter(key => this.schema.getSchemaProperty(key) || key === SETTINGS_PREFS.colorTheme);
        const children = page.children ?? [];
        return <div className='ingot-settings-body' id={`ingot-settings-page-${page.id}`}>
            {page.description && <p className='ingot-settings-description'>{page.description}</p>}
            {keys.map(key => this.renderSetting(key))}
            {page.actions && <div className='ingot-settings-actions'>
                {page.actions.map(a => <button key={a.id} id={`ingot-settings-action-${a.id}`} className='theia-button secondary' onClick={() => this.runAction(a.id)}>{a.label}</button>)}
            </div>}
            {!keys.length && !page.actions && children.length > 0 && <ul className='ingot-settings-links'>
                {children.map(c => <li key={c.id}><a href='#' onClick={e => { e.preventDefault(); this.selected = c.id; this.update(); }}>{c.label}</a></li>)}
            </ul>}
        </div>;
    }

    protected renderSetting(key: string): React.ReactNode {
        const property = this.schema.getSchemaProperty(key);
        const type = Array.isArray(property?.type) ? property?.type[0] : property?.type;
        const value = this.currentValue(key);
        const id = settingDomId(key);
        const options = this.optionsFor(key);
        const info = this.describe(key);
        const modified = this.pending.has(key);
        let control: React.ReactNode;
        if (type === 'boolean') {
            control = <input id={id} type='checkbox' checked={!!value} onChange={e => this.change(key, e.currentTarget.checked)} />;
        } else if (options) {
            control = <select id={id} className='theia-select' value={String(value ?? '')} onChange={e => this.change(key, e.currentTarget.value)}>
                {options.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
            </select>;
        } else {
            const numeric = type === 'number' || type === 'integer';
            control = <input id={id} className='theia-input' type={numeric ? 'number' : 'text'} value={value === undefined ? '' : String(value)} spellCheck={false}
                onChange={e => this.change(key, coerceSetting(e.currentTarget.value, type as string | undefined))} />;
        }
        return <div key={key} className={`ingot-setting${modified ? ' modified' : ''}`} data-key={key}>
            <label htmlFor={id} className='ingot-setting-label'>{settingLabel(key)}</label>
            <div className='ingot-setting-control'>{control}</div>
            {info?.description && <div className='ingot-setting-description'>{info.description}</div>}
        </div>;
    }
}
