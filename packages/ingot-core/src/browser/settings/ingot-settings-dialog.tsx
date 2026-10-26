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
import { MemoriesManager } from '../agents/chat-popovers';
import {
    APPROVAL_KIND_LABELS, APPROVAL_PREFS, toAlwaysRunCommands, toAlwaysRunMap, updateAlwaysRun, updateAlwaysRunCommands, type ApprovalKind
} from '../../common/agents/agent-actions';
import { MemoryStore } from '../agents/memory-store';
import { IngotAccountService } from '../account/account-service';
import { AccountAvatar } from '../account/account-avatar';
import { SETTINGS_ACCOUNT_TEXT } from '../account/account.consts';
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
    @inject(MemoryStore) protected readonly memoryStore: MemoryStore;
    @inject(IngotAccountService) protected readonly accounts: IngotAccountService;

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
        this.toDispose.push(this.accounts.onDidChange(() => this.update()));
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
        // Attaching does not re-render, so render the requested page now (IDEA-117: gear menu › Keymap).
        this.update();
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
            <div className='ingot-settings-top'>
                <span className='codicon codicon-search' />
                <input id='ingot-settings-search' className='ingot-settings-search' placeholder='Search settings' value={this.query} autoFocus spellCheck={false}
                    onChange={e => { this.query = e.currentTarget.value; this.update(); }} />
            </div>
            <div className='ingot-settings-main'>
                <div className='ingot-settings-side'>
                    <div className='ingot-settings-tree' role='tree'>{this.renderTree(SETTINGS_TREE, visible, 0, current?.page.id)}</div>
                </div>
                <div className='ingot-settings-page'>
                    {current
                        ? <>
                            <div className='ingot-settings-crumbs' id='ingot-settings-crumbs'>{current.path.join(' › ')}</div>
                            <h2 className='ingot-settings-title'>{current.page.label}</h2>
                            {this.renderPage(current.page)}
                        </>
                        : <div className='ingot-settings-empty'>No settings match “{this.query}”.</div>}
                </div>
            </div>
        </div>;
    }

    protected renderTree(pages: readonly SettingsPage[], visible: Set<string>, depth: number, selected?: string): React.ReactNode {
        return pages.filter(p => visible.has(p.id)).map(page => {
            const open = !this.collapsed.has(page.id) || !!this.query;
            return <React.Fragment key={page.id}>
                <div id={`ingot-settings-node-${page.id}`} role='treeitem' aria-selected={selected === page.id}
                    className={`ingot-settings-node${selected === page.id ? ' selected' : ''}`} style={{ paddingLeft: 6 + depth * 16 }}
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
                    <span className={`codicon ingot-settings-caret ${page.children ? (open ? 'codicon-chevron-down' : 'codicon-chevron-right') : 'codicon-blank'}`} />
                    {depth === 0 && <span className={`codicon codicon-${page.icon ?? 'circle-small'} ingot-settings-icon`} />}
                    <span className='ingot-settings-node-label'>{page.label}</span>
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
            {page.custom === 'approvals' && this.renderAlwaysRun()}
            {page.custom === 'account' && this.renderAccount()}
            {page.custom === 'memories' && <section className='ingot-settings-card ingot-settings-memories'><MemoriesManager store={this.memoryStore} /></section>}
            {this.groupsFor(page, keys).map(group => <section key={group.label} className='ingot-settings-card'>
                <h3 className='ingot-settings-card-title'>{group.label}</h3>
                {group.preferences.map(key => this.renderSetting(key))}
            </section>)}
            {page.actions && <section className='ingot-settings-card ingot-settings-actions'>
                {page.actions.map(a => <button key={a.id} id={`ingot-settings-action-${a.id}`} className='theia-button secondary' onClick={() => this.runAction(a.id)}>{a.label}</button>)}
            </section>}
            {!keys.length && !page.actions && children.length > 0 && <section className='ingot-settings-card ingot-settings-links'>
                {children.map(c => <a key={c.id} href='#' className='ingot-settings-link' onClick={e => { e.preventDefault(); this.selected = c.id; this.update(); }}>
                    <span>{c.label}</span><span className='codicon codicon-chevron-right' />
                </a>)}
            </section>}
        </div>;
    }

    /** IDEA-143: who is signed in, with the Google / GitHub photo (initials when there is none). */
    protected renderAccount(): React.ReactNode {
        const account = this.accounts.account;
        const plan = this.accounts.snapshot.user?.plan;
        if (!account) {
            return <section className='ingot-settings-card ingot-settings-account' id='ingot-settings-account'>
                <div className='ingot-settings-account-row'>
                    <span className='codicon codicon-account ingot-settings-account-icon' />
                    <div className='ingot-settings-account-text'><b>{SETTINGS_ACCOUNT_TEXT.notSignedIn}</b></div>
                    <button type='button' id='ingot-settings-account-sign-in' className='theia-button' onClick={() => this.accounts.signIn(false)}>{SETTINGS_ACCOUNT_TEXT.signIn}</button>
                </div>
            </section>;
        }
        const src = this.accounts.avatarSrc;
        return <section className='ingot-settings-card ingot-settings-account' id='ingot-settings-account'>
            <div className='ingot-settings-account-row'>
                <AccountAvatar id='ingot-settings-avatar' account={account} src={src} className='ingot-avatar-lg' />
                <div className='ingot-settings-account-text'>
                    <b id='ingot-settings-account-name'>{account.name}</b>
                    {account.email && <span className='ingot-dim'>{account.email}{plan ? ` · ${plan[0].toUpperCase()}${plan.slice(1)}` : ''}</span>}
                    <span className='ingot-dim ingot-settings-account-hint'>{src ? SETTINGS_ACCOUNT_TEXT.photo : SETTINGS_ACCOUNT_TEXT.initials}</span>
                </div>
                <button type='button' id='ingot-settings-account-dashboard' className='theia-button secondary' onClick={() => this.accounts.openDashboard()}>{SETTINGS_ACCOUNT_TEXT.dashboard}</button>
            </div>
        </section>;
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
            <div className='ingot-setting-text'>
                <label htmlFor={id} className='ingot-setting-label'>{settingLabel(key)}</label>
                {info?.description && <div className='ingot-setting-description'>{info.description}</div>}
            </div>
            <div className='ingot-setting-control'>{control}</div>
        </div>;
    }

    protected groupsFor(page: SettingsPage, keys: readonly string[]): { label: string; preferences: string[] }[] {
        const shown = new Set(keys);
        const groups = (page.groups ?? []).map(g => ({ label: g.label, preferences: g.preferences.filter(k => shown.has(k)) }));
        const grouped = new Set(groups.flatMap(g => g.preferences));
        const rest = keys.filter(k => !grouped.has(k));
        return [...groups, ...(rest.length ? [{ label: groups.length ? 'Other' : 'General', preferences: rest }] : [])].filter(g => g.preferences.length);
    }

    /** IDEA-109: "Always Run" choices per project, each revocable. */
    protected renderAlwaysRun(): React.ReactNode {
        const map = toAlwaysRunMap(this.preferences.get(APPROVAL_PREFS.alwaysRun));
        const rows = Object.entries(map).flatMap(([project, kinds]) => kinds.map(kind => ({ project, kind })));
        const revoke = async (project: string, kind: ApprovalKind): Promise<void> => {
            await this.preferences.set(APPROVAL_PREFS.alwaysRun, updateAlwaysRun(toAlwaysRunMap(this.preferences.get(APPROVAL_PREFS.alwaysRun)), project, kind, true), PreferenceScope.User);
            this.update();
        };
        const commands = Object.entries(toAlwaysRunCommands(this.preferences.get(APPROVAL_PREFS.alwaysRunCommands))).flatMap(([project, list]) => list.map(command => ({ project, command })));
        const revokeCommand = async (project: string, command: string): Promise<void> => {
            await this.preferences.set(APPROVAL_PREFS.alwaysRunCommands,
                updateAlwaysRunCommands(toAlwaysRunCommands(this.preferences.get(APPROVAL_PREFS.alwaysRunCommands)), project, command, true), PreferenceScope.User);
            this.update();
        };
        return <section className='ingot-settings-card ingot-settings-always-run' id='ingot-always-run'>
            <h3 className='ingot-settings-card-title'>Always Run</h3>
            {!rows.length && !commands.length && <p className='ingot-dim' id='ingot-always-run-empty'>Nothing runs without asking. Choose “Always Run” on an approval card to skip it for that kind of action in a project.</p>}
            {rows.map(({ project, kind }) => <div key={`${project}:${kind}`} className='ingot-always-run-row' data-kind={kind}>
                <span className='ingot-always-run-kind'>{APPROVAL_KIND_LABELS[kind]}</span>
                <span className='ingot-dim ingot-always-run-project' title={project}>{project}</span>
                <span className='ingot-flex' />
                <button type='button' className='ingot-btn-ghost ingot-always-run-revoke' onClick={() => void revoke(project, kind)}>Revoke</button>
            </div>)}
            {commands.map(({ project, command }) => <div key={`${project}:cmd:${command}`} className='ingot-always-run-row' data-kind='command' data-command={command}>
                <code className='ingot-always-run-command' title={command}>{command}</code>
                <span className='ingot-dim ingot-always-run-project' title={project}>{project}</span>
                <span className='ingot-flex' />
                <button type='button' className='ingot-btn-ghost ingot-always-run-revoke' onClick={() => void revokeCommand(project, command)}>Revoke</button>
            </div>)}
        </section>;
    }

}
