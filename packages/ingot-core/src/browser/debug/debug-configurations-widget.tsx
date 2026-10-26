import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget } from '@theia/core/lib/browser/widgets/react-widget';
import { MessageService } from '@theia/core/lib/common/message-service';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import type { Message } from '@theia/core/shared/@lumino/messaging';
import URI from '@theia/core/lib/common/uri';
import { EditorManager } from '@theia/editor/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { CONFIG_EDITOR_LABEL, CONFIG_EDITOR_WIDGET_ID, CONFIG_FOLDERS, CONFIGURATION_FIELDS, DEBUG_TEMPLATES, LAUNCH_FILE, LAUNCH_FOLDER } from '../../common/debug/debug.consts';
import type { ConfigurationField, LaunchConfiguration } from '../../common/debug/debug.types';
import { applyFieldValue, fieldText, readLaunchConfigurations, removeLaunchConfiguration, uniqueName, upsertLaunchConfiguration } from '../../common/debug/debug.utils';
import { IngotDebugLauncher } from './ingot-debug-launcher';
import { CONFIG_EDITOR_TEXT } from './debug.browser-consts';

const FIELD_TYPE_ALIASES: Readonly<Record<string, string>> = { 'pwa-node': 'node', 'python': 'debugpy' };
const JSON_INDENT = 4;

/** Run/Debug Configurations editor: list, add from a template or a detected config, edit, run and debug (IDEA-138). */
@injectable()
export class IngotDebugConfigurationsWidget extends ReactWidget {

    @inject(IngotDebugLauncher) protected readonly launcher: IngotDebugLauncher;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FileService) protected readonly files: FileService;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(MessageService) protected readonly messages: MessageService;

    protected launchUri?: URI;
    protected launchText?: string;
    protected configurations: LaunchConfiguration[] = [];
    protected selected = -1;
    protected draft?: LaunchConfiguration;
    /** Name the draft had in launch.json (undefined: not saved yet). */
    protected savedName?: string;
    protected jsonText = '';
    protected jsonError?: string;
    protected dirty = false;

    @postConstruct()
    protected init(): void {
        this.id = CONFIG_EDITOR_WIDGET_ID;
        this.title.label = CONFIG_EDITOR_LABEL;
        this.title.caption = CONFIG_EDITOR_LABEL;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-debug-alt';
        this.addClass('ingot-debug-configs');
        this.node.tabIndex = 0;
        this.toDispose.push(this.launcher.onDidChange(() => this.update()));
        this.load();
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    protected get root(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    /** Reads the project's launch.json from `.ingot/` (or another config folder that already has one). */
    async load(selectName?: string): Promise<void> {
        const root = this.root;
        this.launchUri = undefined;
        this.launchText = undefined;
        if (root) {
            for (const folder of CONFIG_FOLDERS) {
                const uri = root.resolve(folder).resolve(LAUNCH_FILE);
                const text = await this.files.read(uri).then(c => c.value).catch(() => undefined);
                if (text !== undefined) {
                    this.launchUri = uri;
                    this.launchText = text;
                    break;
                }
            }
            this.launchUri ??= root.resolve(LAUNCH_FOLDER).resolve(LAUNCH_FILE);
        }
        this.configurations = readLaunchConfigurations(this.launchText);
        const index = selectName ? this.configurations.findIndex(c => c.name === selectName) : Math.min(Math.max(this.selected, 0), this.configurations.length - 1);
        this.selectIndex(index);
    }

    protected selectIndex(index: number): void {
        this.selected = index;
        const configuration = this.configurations[index];
        this.setDraft(configuration, configuration?.name, false);
    }

    protected setDraft(configuration: LaunchConfiguration | undefined, savedName: string | undefined, dirty: boolean): void {
        this.draft = configuration;
        this.savedName = savedName;
        this.jsonText = configuration ? JSON.stringify(configuration, undefined, JSON_INDENT) : '';
        this.jsonError = undefined;
        this.dirty = dirty;
        this.update();
    }

    protected add(configuration: LaunchConfiguration): void {
        const name = uniqueName(configuration.name, this.configurations.map(c => c.name));
        this.selected = -1;
        this.setDraft({ ...configuration, name }, undefined, true);
    }

    protected onAddSelect(event: React.ChangeEvent<HTMLSelectElement>): void {
        const value = event.currentTarget.value;
        event.currentTarget.value = '';
        const template = DEBUG_TEMPLATES.find(t => t.id === value)?.configuration
            ?? this.launcher.detected.find(d => `detected:${d.configuration.name}` === value)?.configuration;
        if (template) {
            this.add(template);
        }
    }

    protected change(next: LaunchConfiguration): void {
        this.draft = next;
        this.jsonText = JSON.stringify(next, undefined, JSON_INDENT);
        this.jsonError = undefined;
        this.dirty = true;
        this.update();
    }

    protected changeJson(text: string): void {
        this.jsonText = text;
        this.dirty = true;
        try {
            const parsed = JSON.parse(text) as LaunchConfiguration;
            if (!parsed || typeof parsed.type !== 'string' || typeof parsed.name !== 'string') {
                throw new Error(CONFIG_EDITOR_TEXT.jsonNeedsTypeAndName);
            }
            this.draft = parsed;
            this.jsonError = undefined;
        } catch (error) {
            this.jsonError = error instanceof Error ? error.message : String(error);
        }
        this.update();
    }

    async save(): Promise<boolean> {
        if (!this.draft || this.jsonError || !this.launchUri) {
            return false;
        }
        const others = this.configurations.filter(c => c.name !== this.savedName).map(c => c.name);
        if (others.includes(this.draft.name)) {
            this.messages.warn(CONFIG_EDITOR_TEXT.duplicateName(this.draft.name));
            return false;
        }
        const text = upsertLaunchConfiguration(this.launchText, this.draft, this.savedName);
        await this.writeLaunch(text);
        await this.load(this.draft.name);
        return true;
    }

    protected async writeLaunch(text: string): Promise<void> {
        if (!this.launchUri) {
            return;
        }
        if (this.launchText === undefined) {
            await this.files.createFile(this.launchUri, BinaryBuffer.fromString(text), { overwrite: true });
        } else {
            await this.files.write(this.launchUri, text);
        }
    }

    protected async remove(): Promise<void> {
        if (this.savedName !== undefined && this.launchText !== undefined) {
            await this.writeLaunch(removeLaunchConfiguration(this.launchText, this.savedName));
        }
        this.selected = Math.max(0, this.selected - 1);
        await this.load();
    }

    protected async startDraft(noDebug: boolean): Promise<void> {
        if (!this.draft || this.jsonError) {
            return;
        }
        if (this.dirty && !await this.save()) {
            return;
        }
        const target = { configuration: this.draft, workspaceFolderUri: this.root?.toString() };
        this.launcher.select(target);
        await this.launcher.start(target, noDebug);
    }

    protected async openFile(): Promise<void> {
        if (this.launchUri) {
            if (this.launchText === undefined) {
                await this.writeLaunch(upsertLaunchConfiguration(undefined, DEBUG_TEMPLATES[0].configuration));
                await this.load();
            }
            await this.editors.open(this.launchUri, { mode: 'activate' });
        }
    }

    protected fields(type: string): readonly ConfigurationField[] {
        return CONFIGURATION_FIELDS[FIELD_TYPE_ALIASES[type] ?? type] ?? [];
    }

    protected renderList(): React.ReactNode {
        return <div className='ingot-dc-list'>
            <div className='ingot-dc-list-header'>
                <span>{CONFIG_EDITOR_TEXT.listTitle}</span>
                <select id='ingot-dc-add' className='theia-select ingot-dc-add' value='' title={CONFIG_EDITOR_TEXT.add} onChange={e => this.onAddSelect(e)}>
                    <option value='' disabled>{CONFIG_EDITOR_TEXT.addPlaceholder}</option>
                    {this.launcher.detected.length > 0 && <optgroup label={CONFIG_EDITOR_TEXT.detectedGroup}>
                        {this.launcher.detected.map(d => <option key={d.configuration.name} value={`detected:${d.configuration.name}`}>{d.configuration.name}</option>)}
                    </optgroup>}
                    <optgroup label={CONFIG_EDITOR_TEXT.templatesGroup}>
                        {DEBUG_TEMPLATES.map(t => <option key={t.id} value={t.id}>{t.label}</option>)}
                    </optgroup>
                </select>
            </div>
            {this.configurations.length === 0 && this.savedName === undefined && !this.draft && <div className='ingot-dc-empty'>{CONFIG_EDITOR_TEXT.empty}</div>}
            {this.configurations.map((c, i) => (
                <button key={c.name} type='button' className={`ingot-dc-item ${i === this.selected ? 'selected' : ''}`} onClick={() => this.selectIndex(i)}>
                    <span className={`ingot-dc-type ingot-dc-type-${FIELD_TYPE_ALIASES[c.type] ?? c.type}`}>{c.type}</span>
                    <span className='ingot-dc-name'>{c.name}</span>
                </button>
            ))}
            {this.draft && this.savedName === undefined && <div className='ingot-dc-item selected unsaved'>
                <span className='ingot-dc-type'>{this.draft.type}</span><span className='ingot-dc-name'>{this.draft.name}</span><span className='ingot-dc-new'>{CONFIG_EDITOR_TEXT.unsaved}</span>
            </div>}
            <div className='ingot-dc-file' title={this.launchUri?.path.fsPath()}>{CONFIG_EDITOR_TEXT.savedIn(this.launchUri ? `${this.launchUri.parent.path.base}/${LAUNCH_FILE}` : LAUNCH_FILE)}</div>
        </div>;
    }

    protected renderForm(draft: LaunchConfiguration): React.ReactNode {
        return <div className='ingot-dc-form'>
            <label className='ingot-dc-row'><span>{CONFIG_EDITOR_TEXT.name}</span>
                <input id='ingot-dc-name' className='theia-input' value={draft.name} onChange={e => this.change({ ...draft, name: e.currentTarget.value })} />
            </label>
            <div className='ingot-dc-row'><span>{CONFIG_EDITOR_TEXT.type}</span>
                <span className='ingot-dc-static'>{draft.type}</span>
                <select className='theia-select ingot-dc-request' value={draft.request} onChange={e => this.change({ ...draft, request: e.currentTarget.value as LaunchConfiguration['request'] })}>
                    <option value='launch'>launch</option>
                    <option value='attach'>attach</option>
                </select>
            </div>
            {this.fields(draft.type).map(f => (
                <label key={f.key} className='ingot-dc-row'><span>{f.label}</span>
                    <input className='theia-input' data-key={f.key} placeholder={f.placeholder} value={fieldText(draft, f.key)}
                        onChange={e => this.change(applyFieldValue(draft, f.key, f.kind, e.currentTarget.value))} />
                </label>
            ))}
            <label className='ingot-dc-row ingot-dc-json'><span>{CONFIG_EDITOR_TEXT.json}</span>
                <textarea id='ingot-dc-json' className='theia-input' spellCheck={false} value={this.jsonText} onChange={e => this.changeJson(e.currentTarget.value)} />
            </label>
            {this.jsonError && <div className='ingot-dc-error'>{this.jsonError}</div>}
            <div className='ingot-dc-actions'>
                <button type='button' id='ingot-dc-debug' className='theia-button main' disabled={!!this.jsonError} onClick={() => this.startDraft(false)}>
                    <span className='codicon codicon-debug-alt-small' /> {CONFIG_EDITOR_TEXT.debug}
                </button>
                <button type='button' id='ingot-dc-run' className='theia-button secondary' disabled={!!this.jsonError} onClick={() => this.startDraft(true)}>
                    <span className='codicon codicon-play' /> {CONFIG_EDITOR_TEXT.run}
                </button>
                <span className='ingot-dc-spacer' />
                <button type='button' id='ingot-dc-remove' className='theia-button secondary' onClick={() => this.remove()}>{CONFIG_EDITOR_TEXT.remove}</button>
                <button type='button' id='ingot-dc-save' className='theia-button main' disabled={!this.dirty || !!this.jsonError} onClick={() => this.save()}>{CONFIG_EDITOR_TEXT.save}</button>
            </div>
        </div>;
    }

    protected render(): React.ReactNode {
        if (!this.root) {
            return <div className='ingot-dc-empty'>{CONFIG_EDITOR_TEXT.noProject}</div>;
        }
        return <div className='ingot-dc'>
            {this.renderList()}
            <div className='ingot-dc-main'>
                <div className='ingot-dc-toolbar'>
                    <span className='ingot-dc-title'>{CONFIG_EDITOR_LABEL}</span>
                    <button type='button' className='theia-button secondary ingot-dc-open' onClick={() => this.openFile()}>{CONFIG_EDITOR_TEXT.openFile}</button>
                </div>
                {this.draft ? this.renderForm(this.draft) : <div className='ingot-dc-empty'>{CONFIG_EDITOR_TEXT.pick}</div>}
            </div>
        </div>;
    }
}
