import * as React from '@theia/core/shared/react';
import { createRoot, type Root } from '@theia/core/shared/react-dom/client';
import * as monaco from '@theia/monaco-editor-core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { BaseWidget, Message, Navigatable, StatefulWidget } from '@theia/core/lib/browser';
import { CommandRegistry } from '@theia/core/lib/common/command';
import { DisposableCollection, type Disposable } from '@theia/core/lib/common/disposable';
import URI from '@theia/core/lib/common/uri';
import { MonacoTextModelService } from '@theia/monaco/lib/browser/monaco-text-model-service';
import { changeHunks, revertHunk, type ChangeHunk } from '../../common/git/changes';
import { ContextKeyService, type ContextKey } from '@theia/core/lib/browser/context-key-service';
import { GitService } from '../../common/git/git.types';
import { LocalChangesModel } from './local-changes-model';
import { COMMIT_COMMANDS, DIFF_FOCUS, DIFF_WIDGET_ID } from './commit.consts';

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
 * IDEA-78: per-chunk revert arrows (‹, back to HEAD, undoable), per-chunk exclude (×) and Revert File.
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
    @inject(ContextKeyService) protected readonly contextKeys: ContextKeyService;
    protected focusKey?: ContextKey<boolean>;
    /** The real file's model behind "Your version" (saved after a chunk revert). */
    protected fileModel?: { save(): Promise<void> };
    protected originalDecorations: monaco.editor.IEditorDecorationsCollection | undefined;

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
        this.focusKey = this.contextKeys.createKey<boolean>(DIFF_FOCUS, false);
        this.node.addEventListener('focusin', () => this.focusKey?.set(true));
        this.node.addEventListener('focusout', e => { if (!this.node.contains(e.relatedTarget as Node | null)) { this.focusKey?.set(false); } });
    }

    protected get tracked(): boolean {
        return this.model.entries.find(e => e.path === this.path)?.status === 'modified';
    }

    /** Puts one chunk back to its HEAD content in the editable side (one undo step). */
    revertChunk(index?: number): void {
        const editor = this.editor;
        const modified = editor?.getModifiedEditor().getModel();
        const original = editor?.getOriginalEditor().getModel();
        const hunk = index !== undefined ? this.hunks.find(h => h.index === index) : this.hunkAtCaret();
        if (!editor || !modified || !original || !hunk || editor.getModifiedEditor().getOption(monaco.editor.EditorOption.readOnly)) {
            return;
        }
        const next = revertHunk(original.getValue(), modified.getValue(), hunk.index);
        editor.getModifiedEditor().pushUndoStop();
        modified.pushEditOperations([], [{ range: modified.getFullModelRange(), text: next }], () => null);
        editor.getModifiedEditor().pushUndoStop();
        this.fileModel?.save().catch(() => undefined);
    }

    /** × on a chunk: exclude it from the commit (click again to include); the file is not changed. */
    ignoreChunk(index?: number): void {
        const hunk = index !== undefined ? this.hunks.find(h => h.index === index) : this.hunkAtCaret();
        if (hunk && this.tracked) {
            this.model.toggleHunk(this.path, hunk.index);
        }
    }

    protected hunkAtCaret(): ChangeHunk | undefined {
        const line = this.editor?.getModifiedEditor().getPosition()?.lineNumber;
        return line ? this.hunkAtLine(line) ?? this.hunks[0] : this.hunks[0];
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
                lineDecorationsWidth: 18,
                // Ingot draws its own ‹ revert arrows per chunk (IDEA-78); keep side-by-side unless the user picks Unified.
                renderMarginRevertIcon: false,
                useInlineViewWhenSpaceIsLimited: false,
                ignoreTrimWhitespace: false,
                // The +/- indicators share the line-decoration lane with the ‹ revert arrows.
                renderIndicators: false,
                minimap: { enabled: false },
                scrollBeyondLastLine: false
            });
            this.toDispose.push({ dispose: () => this.editor?.dispose() });
            this.editor.getOriginalEditor().updateOptions({ glyphMargin: true });
            this.toDispose.push(this.editor.getModifiedEditor().onMouseDown(e => {
                const line = e.target.position?.lineNumber;
                const hunk = line !== undefined ? this.hunks.find(h => this.markerLine(h) === line) ?? this.hunkAtLine(line) : undefined;
                if (!hunk) {
                    return;
                }
                if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
                    this.model.toggleHunk(this.path, hunk.index);
                } else if (e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS && this.markerLine(hunk) === line) {
                    this.revertChunk(hunk.index);
                }
            }));
            this.toDispose.push(this.editor.getOriginalEditor().onMouseDown(e => {
                const line = e.target.position?.lineNumber;
                if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && line !== undefined) {
                    const hunk = this.hunks.find(h => this.baseMarkerLine(h) === line);
                    if (hunk) {
                        this.ignoreChunk(hunk.index);
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
            this.fileModel = reference.object;
            modified = reference.object.textEditorModel;
        } else {
            this.fileModel = undefined;
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

    /** The base-side line that carries the × (exclude) marker. */
    protected baseMarkerLine(h: ChangeHunk): number {
        const lines = this.editor?.getOriginalEditor().getModel()?.getLineCount() ?? 1;
        return Math.min(Math.max(1, h.baseCount ? h.baseStart : h.baseStart - 1), lines);
    }

    protected decorate(): void {
        const modified = this.editor?.getModifiedEditor();
        const original = this.editor?.getOriginalEditor();
        if (!modified || !original) {
            return;
        }
        const tracked = this.tracked;
        const editable = !modified.getOption(monaco.editor.EditorOption.readOnly);
        const decorations: monaco.editor.IModelDeltaDecoration[] = this.hunks.flatMap(h => {
            const included = this.model.isHunkIncluded(this.path, h.index);
            const line = this.markerLine(h);
            const out: monaco.editor.IModelDeltaDecoration[] = [];
            out.push({
                range: new monaco.Range(line, 1, line, 1),
                options: {
                    ...(tracked ? {
                        glyphMarginClassName: `ingot-hunk-check codicon ${included ? 'codicon-pass-filled checked' : 'codicon-circle-large-outline'}`,
                        glyphMarginHoverMessage: { value: included ? 'Included in commit — click to exclude this chunk' : 'Excluded from commit — click to include this chunk' }
                    } : {}),
                    ...(editable ? { linesDecorationsClassName: 'ingot-hunk-revert codicon codicon-chevron-left' } : {})
                }
            });
            if (!included && h.workCount) {
                out.push({ range: new monaco.Range(h.workStart, 1, h.workStart + h.workCount - 1, 1), options: { isWholeLine: true, className: 'ingot-hunk-ignored' } });
            }
            return out;
        });
        const baseDecorations: monaco.editor.IModelDeltaDecoration[] = tracked ? this.hunks.map(h => ({
            range: new monaco.Range(this.baseMarkerLine(h), 1, this.baseMarkerLine(h), 1),
            options: {
                glyphMarginClassName: `ingot-hunk-ignore codicon codicon-close${this.model.isHunkIncluded(this.path, h.index) ? '' : ' active'}`,
                glyphMarginHoverMessage: { value: this.model.isHunkIncluded(this.path, h.index) ? 'Exclude this chunk from the commit (the file is not changed)' : 'Excluded — click to include this chunk again' }
            }
        })) : [];
        if (this.decorations) {
            this.decorations.set(decorations);
        } else {
            this.decorations = modified.createDecorationsCollection(decorations);
        }
        if (this.originalDecorations) {
            this.originalDecorations.set(baseDecorations);
        } else {
            this.originalDecorations = original.createDecorationsCollection(baseDecorations);
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
            {tool('revert-chunk', 'discard', 'Revert Chunk at Caret (⌘⌥Z)', () => this.revertChunk(), !this.hunks.length)}
            {tool('ignore-chunk', 'close', 'Exclude Chunk at Caret from Commit', () => this.ignoreChunk(), !this.hunks.length || !this.tracked)}
            {tool('revert-file', 'history', 'Revert File…', () => this.commands.executeCommand(COMMIT_COMMANDS.rollback.id, [this.path]))}
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
