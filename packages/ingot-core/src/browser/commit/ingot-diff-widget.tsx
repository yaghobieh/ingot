import * as React from '@theia/core/shared/react';
import { createRoot, type Root } from '@theia/core/shared/react-dom/client';
import * as monaco from '@theia/monaco-editor-core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { BaseWidget, Message, Navigatable, StatefulWidget } from '@theia/core/lib/browser';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { DisposableCollection, type Disposable } from '@theia/core/lib/common/disposable';
import URI from '@theia/core/lib/common/uri';
import { MonacoTextModelService } from '@theia/monaco/lib/browser/monaco-text-model-service';
import { changeHunks, type ChangeHunk } from '../../common/git/changes';
import { GitService } from '../../common/git/git.types';
import { LocalChangesModel } from './local-changes-model';
import { COMMIT_COMMANDS, DIFF_WIDGET_ID } from './commit.consts';

export interface DiffWidgetOptions {
    readonly path: string;
}

type Viewer = 'side-by-side' | 'unified';
type Whitespace = 'none' | 'trim';
type Highlight = 'words' | 'lines';

/**
 * Diff editor tab for one local change (IDEA-74): HEAD (read-only) on the left, "Your version" (editable, the
 * real file) on the right; change and file navigation, viewer / whitespace / highlight options, collapse
 * unchanged, and a per-chunk checkbox in the gutter that picks the chunks to commit.
 */
@injectable()
export class IngotDiffWidget extends BaseWidget implements Navigatable, StatefulWidget {

    static createId(path: string): string {
        return `${DIFF_WIDGET_ID}:${path}`;
    }

    @inject(LocalChangesModel) protected readonly model: LocalChangesModel;
    @inject(MonacoTextModelService) protected readonly textModels: MonacoTextModelService;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;
    @inject(GitService) protected readonly git: GitService;

    path = '';
    protected toolbarRoot: Root;
    protected toolbarHost: HTMLElement;
    protected headers: HTMLElement;
    protected editorHost: HTMLElement;
    protected editor: monaco.editor.IStandaloneDiffEditor | undefined;
    protected readonly fileDisposables = new DisposableCollection();
    protected hunks: ChangeHunk[] = [];
    protected decorations: monaco.editor.IEditorDecorationsCollection | undefined;
    protected headSha = '';
    protected viewer: Viewer = 'side-by-side';
    protected whitespace: Whitespace = 'none';
    protected highlight: Highlight = 'words';
    protected collapseUnchanged = false;

    init(options: DiffWidgetOptions): void {
        this.id = IngotDiffWidget.createId(options.path);
        this.addClass('ingot-diff');
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-diff';
        this.toolbarHost = document.createElement('div');
        this.toolbarHost.className = 'ingot-diff-toolbar';
        this.headers = document.createElement('div');
        this.headers.className = 'ingot-diff-headers';
        this.editorHost = document.createElement('div');
        this.editorHost.className = 'ingot-diff-editor';
        this.node.append(this.toolbarHost, this.headers, this.editorHost);
        this.toolbarRoot = createRoot(this.toolbarHost);
        this.toDispose.push({ dispose: () => this.toolbarRoot.unmount() });
        this.toDispose.push(this.fileDisposables);
        this.toDispose.push(this.model.onDidChange(() => { this.renderToolbar(); this.decorate(); }));
        this.path = options.path;
    }

    getResourceUri(): URI | undefined {
        return this.model.uriOf(this.path);
    }

    createMoveToUri(): URI | undefined {
        return undefined;
    }

    storeState(): object {
        return { path: this.path };
    }

    restoreState(): void {
        // Diffs are not restored across sessions.
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        if (!this.editor) {
            this.editor = monaco.editor.createDiffEditor(this.editorHost, {
                automaticLayout: true,
                renderSideBySide: true,
                originalEditable: false,
                readOnly: false,
                glyphMargin: true,
                renderMarginRevertIcon: true,
                ignoreTrimWhitespace: false,
                renderIndicators: true,
                minimap: { enabled: false },
                scrollBeyondLastLine: false
            });
            this.toDispose.push({ dispose: () => this.editor?.dispose() });
            this.toDispose.push(this.editor.getModifiedEditor().onMouseDown(e => {
                if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && e.target.position) {
                    const hunk = this.hunkAtLine(e.target.position.lineNumber);
                    if (hunk) {
                        this.model.toggleHunk(this.path, hunk.index);
                    }
                }
            }));
            this.showFile(this.path);
        }
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.editor?.getModifiedEditor().focus();
    }

    /** Shows another file in this tab (prev/next file navigation). */
    async showFile(path: string): Promise<void> {
        this.fileDisposables.dispose();
        this.path = path;
        this.title.label = path.split('/').pop() ?? path;
        this.title.caption = `${path} (HEAD ↔ Your version)`;
        const entry = this.model.entries.find(e => e.path === path);
        const uri = this.model.uriOf(path);
        const base = entry?.status === 'untracked' || entry?.status === 'added' ? '' : await this.model.base(entry?.oldPath ?? path);
        let modified: monaco.editor.ITextModel;
        if (uri && entry?.status !== 'deleted') {
            const reference = await this.textModels.createModelReference(uri);
            this.fileDisposables.push(reference as Disposable);
            modified = reference.object.textEditorModel;
        } else {
            modified = monaco.editor.createModel('', undefined);
            this.fileDisposables.push(modified);
        }
        const original = monaco.editor.createModel(base, modified.getLanguageId());
        this.fileDisposables.push(original);
        this.editor?.setModel({ original, modified });
        this.editor?.getModifiedEditor().updateOptions({ readOnly: entry?.status === 'deleted' });
        this.headSha = this.model.root ? await this.headShort() : '';
        this.headers.innerHTML = '';
        const left = document.createElement('span');
        left.className = 'ingot-diff-header-left';
        left.textContent = `${this.headSha || 'HEAD'} (read-only)`;
        const right = document.createElement('span');
        right.className = 'ingot-diff-header-right';
        right.textContent = 'Your version';
        this.headers.append(left, right);
        const recompute = () => {
            this.hunks = changeHunks(original.getValue(), modified.getValue());
            this.decorate();
        };
        this.fileDisposables.push(modified.onDidChangeContent(() => recompute()));
        recompute();
        this.renderToolbar();
        // Jump to the first change once the diff is computed.
        const once = this.editor?.onDidUpdateDiff(() => { once?.dispose(); this.editor?.goToDiff('next'); });
        if (once) {
            this.fileDisposables.push(once);
        }
    }

    protected async headShort(): Promise<string> {
        const root = this.model.root;
        if (!root) {
            return '';
        }
        try {
            return (await this.git.run(root, { kind: 'revParse', ref: 'HEAD' })).output.trim().slice(0, 12);
        } catch {
            return '';
        }
    }

    protected hunkAtLine(line: number): ChangeHunk | undefined {
        return this.hunks.find(h => line >= this.markerLine(h) && line <= Math.max(this.markerLine(h), h.workStart + h.workCount - 1));
    }

    /** The modified-side line that carries the chunk checkbox. */
    protected markerLine(h: ChangeHunk): number {
        const lines = this.editor?.getModifiedEditor().getModel()?.getLineCount() ?? 1;
        return Math.min(Math.max(1, h.workCount ? h.workStart : h.workStart - 1), lines);
    }

    protected decorate(): void {
        const modified = this.editor?.getModifiedEditor();
        if (!modified) {
            return;
        }
        const tracked = this.model.entries.find(e => e.path === this.path)?.status === 'modified';
        const decorations: monaco.editor.IModelDeltaDecoration[] = tracked ? this.hunks.map(h => ({
            range: new monaco.Range(this.markerLine(h), 1, this.markerLine(h), 1),
            options: {
                glyphMarginClassName: `ingot-hunk-check codicon ${this.model.isHunkIncluded(this.path, h.index) ? 'codicon-pass-filled checked' : 'codicon-circle-large-outline'}`,
                glyphMarginHoverMessage: { value: this.model.isHunkIncluded(this.path, h.index) ? 'Included in commit — click to exclude this chunk' : 'Excluded from commit — click to include this chunk' }
            }
        })) : [];
        if (this.decorations) {
            this.decorations.set(decorations);
        } else {
            this.decorations = modified.createDecorationsCollection(decorations);
        }
        this.node.dataset.hunks = String(this.hunks.length);
        this.node.dataset.included = String(this.hunks.filter(h => this.model.isHunkIncluded(this.path, h.index)).length);
    }

    protected neighbour(step: number): string | undefined {
        const paths = this.model.entries.map(e => e.path);
        const i = paths.indexOf(this.path);
        return i < 0 ? undefined : paths[i + step];
    }

    protected setOption(patch: Partial<{ viewer: Viewer; whitespace: Whitespace; highlight: Highlight; collapseUnchanged: boolean }>): void {
        Object.assign(this, patch);
        this.editor?.updateOptions({
            renderSideBySide: this.viewer === 'side-by-side',
            ignoreTrimWhitespace: this.whitespace === 'trim',
            hideUnchangedRegions: { enabled: this.collapseUnchanged }
        });
        this.node.classList.toggle('ingot-diff-lines-only', this.highlight === 'lines');
        this.renderToolbar();
    }

    protected renderToolbar(): void {
        if (!this.toolbarRoot) {
            return;
        }
        const tool = (id: string, icon: string, title: string, onClick: () => void, disabled = false, active = false) =>
            <button type='button' id={`ingot-diff-${id}`} className={`ingot-lc-tool ${active ? 'active' : ''}`} title={title} aria-label={title} disabled={disabled} onClick={onClick}>
                <span className={`codicon codicon-${icon}`} />
            </button>;
        const prev = this.neighbour(-1);
        const next = this.neighbour(1);
        this.toolbarRoot.render(<div className='ingot-diff-tools' role='toolbar'>
            {tool('prev-change', 'arrow-up', 'Previous Difference (⇧F7)', () => this.editor?.goToDiff('previous'))}
            {tool('next-change', 'arrow-down', 'Next Difference (F7)', () => this.editor?.goToDiff('next'))}
            {tool('edit', 'edit', 'Jump to Source (F4)', () => this.commands.executeCommand(COMMIT_COMMANDS.jumpToSource.id, [this.path]))}
            <span className='ingot-lc-sep' />
            {tool('prev-file', 'arrow-left', `Previous File${prev ? `: ${prev}` : ''}`, () => prev && this.showFile(prev), !prev)}
            {tool('next-file', 'arrow-right', `Next File${next ? `: ${next}` : ''}`, () => next && this.showFile(next), !next)}
            <select id='ingot-diff-viewer' className='ingot-select' aria-label='Viewer' value={this.viewer} onChange={e => this.setOption({ viewer: e.currentTarget.value as Viewer })}>
                <option value='side-by-side'>Side-by-side viewer</option>
                <option value='unified'>Unified viewer</option>
            </select>
            <select id='ingot-diff-whitespace' className='ingot-select' aria-label='Whitespace' value={this.whitespace} onChange={e => this.setOption({ whitespace: e.currentTarget.value as Whitespace })}>
                <option value='none'>Do not ignore</option>
                <option value='trim'>Trim whitespaces</option>
            </select>
            <select id='ingot-diff-highlight' className='ingot-select' aria-label='Highlighting' value={this.highlight} onChange={e => this.setOption({ highlight: e.currentTarget.value as Highlight })}>
                <option value='words'>Highlight words</option>
                <option value='lines'>Highlight lines</option>
            </select>
            {tool('collapse', 'fold', 'Collapse Unchanged Fragments', () => this.setOption({ collapseUnchanged: !this.collapseUnchanged }), false, this.collapseUnchanged)}
            <span className='ingot-flex' />
            <span className='ingot-diff-summary' id='ingot-diff-summary'>
                {this.hunks.length} change{this.hunks.length === 1 ? '' : 's'}
                {this.hunks.length > 0 && ` · ${this.hunks.filter(h => this.model.isHunkIncluded(this.path, h.index)).length} included`}
            </span>
            {tool('settings', 'settings-gear', 'Diff settings', () => this.commands.executeCommand('ingot.settings.open'))}
        </div>);
    }
}
