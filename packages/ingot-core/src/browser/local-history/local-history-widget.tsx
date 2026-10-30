import * as React from '@theia/core/shared/react';
import { createRoot, type Root } from '@theia/core/shared/react-dom/client';
import * as monaco from '@theia/monaco-editor-core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { BaseWidget, Message, Navigatable } from '@theia/core/lib/browser';
import { DisposableCollection, type Disposable } from '@theia/core/lib/common/disposable';
import URI from '@theia/core/lib/common/uri';
import { MonacoTextModelService } from '@theia/monaco/lib/browser/monaco-text-model-service';
import { HISTORY_SOURCE_LABELS } from '../../common/local-history/local-history.consts';
import type { HistoryEntry } from '../../common/local-history/local-history.types';
import { formatEntryTime } from '../../common/local-history/local-history.utils';
import { LocalHistoryService } from './local-history-service';
import { LOCAL_HISTORY_TEXT, LOCAL_HISTORY_WIDGET_ID } from './local-history.browser-consts';

export interface LocalHistoryWidgetOptions {
    readonly uri: string;
}

/**
 * Local History tab (IDEA-262): the file's versions (newest first) on the left, the picked version against the
 * current file on the right, and Restore to put that version back.
 */
@injectable()
export class LocalHistoryWidget extends BaseWidget implements Navigatable {

    static createId(uri: string): string {
        return `${LOCAL_HISTORY_WIDGET_ID}:${uri}`;
    }

    @inject(LocalHistoryService) protected readonly history: LocalHistoryService;
    @inject(MonacoTextModelService) protected readonly textModels: MonacoTextModelService;

    protected uri: URI;
    protected entries: readonly HistoryEntry[] = [];
    protected selected?: string;
    protected listRoot: Root;
    protected headerRoot: Root;
    protected editorHost: HTMLElement;
    protected placeholder: HTMLElement;
    protected editor?: monaco.editor.IStandaloneDiffEditor;
    protected current?: monaco.editor.ITextModel;
    protected readonly versionModel = new DisposableCollection();

    init(options: LocalHistoryWidgetOptions): void {
        this.uri = new URI(options.uri);
        this.id = LocalHistoryWidget.createId(options.uri);
        this.addClass('ingot-local-history');
        this.title.label = `${LOCAL_HISTORY_TEXT.title}: ${this.uri.path.base}`;
        this.title.caption = `${LOCAL_HISTORY_TEXT.title}: ${this.history.location(this.uri)?.relative ?? this.uri.path.toString()}`;
        this.title.iconClass = 'codicon codicon-history';
        this.title.closable = true;
        const header = document.createElement('div');
        header.className = 'ingot-lh-header';
        const body = document.createElement('div');
        body.className = 'ingot-lh-body';
        const list = document.createElement('div');
        list.className = 'ingot-lh-list';
        list.setAttribute('role', 'listbox');
        list.setAttribute('aria-label', 'Versions');
        const pane = document.createElement('div');
        pane.className = 'ingot-lh-pane';
        this.editorHost = document.createElement('div');
        this.editorHost.className = 'ingot-lh-editor';
        this.placeholder = document.createElement('div');
        this.placeholder.className = 'ingot-lh-placeholder';
        pane.append(this.placeholder, this.editorHost);
        body.append(list, pane);
        this.node.append(header, body);
        this.node.tabIndex = -1;
        this.headerRoot = createRoot(header);
        this.listRoot = createRoot(list);
        this.toDispose.push({ dispose: () => { this.headerRoot.unmount(); this.listRoot.unmount(); } });
        this.toDispose.push(this.versionModel);
        this.toDispose.push(this.history.onDidChange(uri => uri === this.uri.toString() && void this.refresh()));
    }

    getResourceUri(): URI | undefined {
        return this.uri;
    }

    createMoveToUri(): URI | undefined {
        return undefined;
    }

    async refresh(): Promise<void> {
        this.entries = await this.history.entries(this.uri);
        if (!this.entries.some(e => e.id === this.selected)) {
            this.selected = this.entries[0]?.id;
        }
        this.render();
        await this.showSelected();
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        if (!this.editor) {
            this.editor = monaco.editor.createDiffEditor(this.editorHost, {
                automaticLayout: true,
                renderSideBySide: true,
                originalEditable: false,
                readOnly: true,
                renderMarginRevertIcon: false,
                useInlineViewWhenSpaceIsLimited: false,
                minimap: { enabled: false },
                scrollBeyondLastLine: false
            });
            this.toDispose.push({ dispose: () => this.editor?.dispose() });
            void this.loadCurrent().then(() => this.refresh());
        }
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        (this.node.querySelector<HTMLElement>('.ingot-lh-entry.selected') ?? this.node).focus();
    }

    protected async loadCurrent(): Promise<void> {
        const reference = await this.textModels.createModelReference(this.uri);
        this.toDispose.push(reference as Disposable);
        this.current = reference.object.textEditorModel;
    }

    protected async select(id: string): Promise<void> {
        this.selected = id;
        this.render();
        await this.showSelected();
    }

    protected async showSelected(): Promise<void> {
        const entry = this.entries.find(e => e.id === this.selected);
        this.placeholder.textContent = this.entries.length ? LOCAL_HISTORY_TEXT.pick : LOCAL_HISTORY_TEXT.empty;
        this.node.classList.toggle('ingot-lh-has-version', !!entry);
        if (!entry || !this.editor || !this.current) {
            return;
        }
        const text = await this.history.read(this.uri, entry);
        if (this.selected !== entry.id) {
            return;
        }
        this.versionModel.dispose();
        const original = monaco.editor.createModel(text, this.current.getLanguageId());
        this.editor.setModel({ original, modified: this.current });
        this.versionModel.push(original);
    }

    protected async restoreSelected(): Promise<void> {
        const entry = this.entries.find(e => e.id === this.selected);
        if (entry) {
            await this.history.restore(this.uri, entry);
        }
    }

    protected onListKey(event: React.KeyboardEvent): void {
        const at = this.entries.findIndex(e => e.id === this.selected);
        const step = event.key === 'ArrowDown' ? 1 : event.key === 'ArrowUp' ? -1 : 0;
        const next = this.entries[at + step];
        if (step && next) {
            event.preventDefault();
            void this.select(next.id).then(() => this.node.querySelector<HTMLElement>('.ingot-lh-entry.selected')?.focus());
        }
    }

    protected render(): void {
        const entry = this.entries.find(e => e.id === this.selected);
        const now = Date.now();
        this.headerRoot.render(<>
            <span className='ingot-lh-title'>{this.title.caption}</span>
            <span className='ingot-lh-compare'>
                {entry ? `${formatEntryTime(entry.timestamp, now)} · ${entry.label}` : ''}
                {entry ? <span className='ingot-lh-arrow codicon codicon-arrow-right' /> : undefined}
                {entry ? LOCAL_HISTORY_TEXT.current : ''}
            </span>
            <button type='button' id='ingot-lh-refresh' className='ingot-lh-icon codicon codicon-refresh' title={LOCAL_HISTORY_TEXT.refresh}
                aria-label={LOCAL_HISTORY_TEXT.refresh} onClick={() => void this.refresh()} />
            <button type='button' id='ingot-lh-restore' className='ingot-lh-restore' disabled={!entry} title={LOCAL_HISTORY_TEXT.restoreHint}
                onClick={() => void this.restoreSelected()}>
                <span className='codicon codicon-discard' />{LOCAL_HISTORY_TEXT.restore}
            </button>
        </>);
        this.listRoot.render(<>
            {this.entries.map(e => (
                <div key={e.id} role='option' tabIndex={e.id === this.selected ? 0 : -1} aria-selected={e.id === this.selected}
                    className={`ingot-lh-entry${e.id === this.selected ? ' selected' : ''}`} data-source={e.source} data-entry={e.id}
                    onClick={() => void this.select(e.id)} onKeyDown={event => this.onListKey(event)}>
                    <span className='ingot-lh-time'>{formatEntryTime(e.timestamp, now)}</span>
                    <span className='ingot-lh-label'>{e.label}</span>
                    <span className='ingot-lh-source' title={HISTORY_SOURCE_LABELS[e.source]} />
                </div>
            ))}
        </>);
    }
}
