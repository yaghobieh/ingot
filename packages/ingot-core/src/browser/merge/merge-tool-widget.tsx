import * as React from '@theia/core/shared/react';
import { createRoot, type Root } from '@theia/core/shared/react-dom/client';
import * as monaco from '@theia/monaco-editor-core';
import { inject, injectable } from '@theia/core/shared/inversify';
import { BaseWidget, Message } from '@theia/core/lib/browser';
import { ContextKeyService, type ContextKey } from '@theia/core/lib/browser/context-key-service';
import { ConfirmDialog } from '@theia/core/lib/browser/dialogs';
import { MessageService } from '@theia/core/lib/common/message-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { GitService } from '../../common/git/git.types';
import { MERGE_AI_SYSTEM, buildMerged, chunkLines, extractMergedFile, merge3, mergeAiPrompt, nonConflictingChoice, splitText, type ChunkChoice, type MergeChunk } from '../../common/git/merge3';
import { IngotModelClient } from '../models/model-client';
import { LocalChangesModel } from '../commit/local-changes-model';
import { MERGE_FOCUS, MERGE_WIDGET_ID } from './merge.consts';

export interface MergeToolOptions {
    readonly path: string;
}

interface ChunkState { ours: boolean; theirs: boolean; ignored: boolean }

/**
 * Three-pane merge tool (IDEA-33): Yours (read-only) | Result (editable) | Theirs (read-only).
 * » / « apply a side's chunk into the Result, × ignores it; non-conflicting changes in one click;
 * Accept Yours / Theirs for the whole file; an AI proposal is shown as a diff and only applied on request.
 */
@injectable()
export class IngotMergeWidget extends BaseWidget {

    static createId(path: string): string {
        return `${MERGE_WIDGET_ID}:${path}`;
    }

    @inject(GitService) protected readonly git: GitService;
    @inject(LocalChangesModel) protected readonly changes: LocalChangesModel;
    @inject(FileService) protected readonly files: FileService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(IngotModelClient) protected readonly models: IngotModelClient;
    @inject(ContextKeyService) protected readonly contextKeys: ContextKeyService;

    path = '';
    protected toolbarRoot: Root;
    protected footerRoot: Root;
    protected panes: HTMLElement;
    protected overlay: HTMLElement;
    protected overlayRoot: Root;
    protected yoursEditor?: monaco.editor.IStandaloneCodeEditor;
    protected resultEditor?: monaco.editor.IStandaloneCodeEditor;
    protected theirsEditor?: monaco.editor.IStandaloneCodeEditor;
    protected readonly models3: monaco.editor.ITextModel[] = [];
    protected base = '';
    protected ours = '';
    protected theirs = '';
    protected chunks: MergeChunk[] = [];
    protected state = new Map<number, ChunkState>();
    /** Tracked ranges of each chunk inside the Result model (they move with edits). */
    protected regionIds: string[] = [];
    protected decorations: { [pane: string]: monaco.editor.IEditorDecorationsCollection } = {};
    protected yoursLabel = 'Yours';
    protected theirsLabel = 'Theirs';
    protected aiBusy = false;
    protected focusKey?: ContextKey<boolean>;
    protected resolved?: () => void;

    init(options: MergeToolOptions): void {
        this.id = IngotMergeWidget.createId(options.path);
        this.path = options.path;
        this.addClass('ingot-merge');
        this.title.label = `Merge ${options.path.split('/').pop()}`;
        this.title.caption = `Merge Revisions for ${options.path}`;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-git-merge';
        const toolbar = document.createElement('div');
        toolbar.className = 'ingot-merge-toolbar';
        this.panes = document.createElement('div');
        this.panes.className = 'ingot-merge-panes';
        const footer = document.createElement('div');
        footer.className = 'ingot-merge-footer';
        this.overlay = document.createElement('div');
        this.overlay.className = 'ingot-merge-overlay';
        this.node.append(toolbar, this.panes, footer, this.overlay);
        this.toolbarRoot = createRoot(toolbar);
        this.footerRoot = createRoot(footer);
        this.overlayRoot = createRoot(this.overlay);
        this.toDispose.push({ dispose: () => { this.toolbarRoot.unmount(); this.footerRoot.unmount(); this.overlayRoot.unmount(); } });
        this.toDispose.push({ dispose: () => this.models3.forEach(m => m.dispose()) });
        this.focusKey = this.contextKeys.createKey<boolean>(MERGE_FOCUS, false);
        this.node.tabIndex = -1;
        this.node.addEventListener('focusin', () => this.focusKey?.set(true));
        this.node.addEventListener('focusout', e => { if (!this.node.contains(e.relatedTarget as Node | null)) { this.focusKey?.set(false); } });
    }

    /** Resolves when the file was applied (or accepted) and the tab closed. */
    onResolved(callback: () => void): void {
        this.resolved = callback;
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        if (!this.resultEditor) {
            this.load();
        }
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        (this.resultEditor ?? this.node).focus();
    }

    protected pane(title: string, cls: string): HTMLElement {
        const pane = document.createElement('div');
        pane.className = `ingot-merge-pane ${cls}`;
        const head = document.createElement('div');
        head.className = 'ingot-merge-pane-title';
        head.textContent = title;
        const host = document.createElement('div');
        host.className = 'ingot-merge-editor';
        pane.append(head, host);
        this.panes.append(pane);
        return host;
    }

    protected async stage(stage: 1 | 2 | 3): Promise<string> {
        const root = this.changes.root;
        return root ? (await this.git.run(root, { kind: 'showStage', stage, path: this.path }).catch(() => ({ output: '' }))).output : '';
    }

    protected async load(): Promise<void> {
        const root = this.changes.root;
        [this.base, this.ours, this.theirs] = await Promise.all([this.stage(1), this.stage(2), this.stage(3)]);
        if (root) {
            this.yoursLabel = (await this.git.run(root, { kind: 'currentBranch' }).catch(() => ({ output: '' }))).output.trim() || 'HEAD';
            const theirs = await this.git.run(root, { kind: 'revParse', ref: 'MERGE_HEAD' }).catch(() => this.git.run(root, { kind: 'revParse', ref: 'REBASE_HEAD' })).catch(() => ({ output: '' }));
            this.theirsLabel = theirs.output.trim().slice(0, 8) || 'incoming';
        }
        this.chunks = merge3(this.base, this.ours, this.theirs);
        this.state = new Map(this.chunks.map(c => [c.index, { ours: false, theirs: false, ignored: c.kind === 'same' ? false : false }]));
        const uri = (name: string) => monaco.Uri.parse(`inmemory://ingot-merge/${name}/${this.path}`);
        const make = (text: string, name: string) => {
            const model = monaco.editor.createModel(text, undefined, uri(name));
            this.models3.push(model);
            return model;
        };
        const common: monaco.editor.IStandaloneEditorConstructionOptions = {
            automaticLayout: true, minimap: { enabled: false }, scrollBeyondLastLine: false, glyphMargin: true, lineDecorationsWidth: 6, fontSize: 13
        };
        this.yoursEditor = monaco.editor.create(this.pane(`Changes from ${this.yoursLabel} (yours, read-only)`, 'ingot-merge-yours'), { ...common, model: make(this.ours, 'yours'), readOnly: true });
        this.resultEditor = monaco.editor.create(this.pane('Result', 'ingot-merge-result'), { ...common, model: make(this.base, 'result') });
        this.theirsEditor = monaco.editor.create(this.pane(`Changes from ${this.theirsLabel} (theirs, read-only)`, 'ingot-merge-theirs'), { ...common, model: make(this.theirs, 'theirs'), readOnly: true });
        this.toDispose.push({ dispose: () => [this.yoursEditor, this.resultEditor, this.theirsEditor].forEach(e => e?.dispose()) });
        const result = this.resultEditor.getModel()!;
        this.regionIds = result.deltaDecorations([], this.chunks.map(c => ({
            range: new monaco.Range(c.baseStart + 1, 1, c.baseEnd + 1, 1),
            options: { stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges }
        })));
        for (const [editor, side] of [[this.yoursEditor, 'ours'], [this.theirsEditor, 'theirs']] as const) {
            this.toDispose.push(editor.onMouseDown(e => {
                const line = e.target.position?.lineNumber;
                if (line === undefined || (e.target.type !== monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN && e.target.type !== monaco.editor.MouseTargetType.GUTTER_LINE_DECORATIONS)) {
                    return;
                }
                const chunk = this.chunks.find(c => this.sideMarker(c, side) === line && this.isOpen(c));
                if (!chunk) {
                    return;
                }
                if (e.target.type === monaco.editor.MouseTargetType.GUTTER_GLYPH_MARGIN) {
                    this.apply(chunk.index, side);
                } else {
                    this.ignore(chunk.index);
                }
            }));
        }
        // Keep the three panes scrolled together.
        const editors = [this.yoursEditor, this.resultEditor, this.theirsEditor];
        let syncing = false;
        for (const source of editors) {
            this.toDispose.push(source.onDidScrollChange(e => {
                if (syncing || !e.scrollTopChanged) {
                    return;
                }
                syncing = true;
                editors.filter(x => x !== source).forEach(x => x.setScrollTop(e.scrollTop));
                syncing = false;
            }));
        }
        this.toDispose.push(result.onDidChangeContent(() => this.refresh()));
        this.refresh();
        const first = this.chunks.find(c => c.kind === 'conflict');
        if (first) {
            this.resultEditor.revealLineInCenter(first.baseStart + 1);
        }
    }

    protected isOpen(c: MergeChunk): boolean {
        const s = this.state.get(c.index);
        return !!s && !s.ignored && !(c.kind === 'conflict' ? s.ours && s.theirs : s.ours || s.theirs);
    }

    protected isResolved(c: MergeChunk): boolean {
        const s = this.state.get(c.index);
        return !!s && (s.ignored || s.ours || s.theirs);
    }

    get conflictsLeft(): number {
        return this.chunks.filter(c => c.kind === 'conflict' && !this.isResolved(c)).length;
    }

    get changesLeft(): number {
        return this.chunks.filter(c => c.kind !== 'conflict' && !this.isResolved(c)).length;
    }

    /** Line in a side pane where a chunk's marker sits. */
    protected sideMarker(c: MergeChunk, side: 'ours' | 'theirs'): number {
        const sideLines = side === 'ours' ? this.chunkStartIn(c, 'ours') : this.chunkStartIn(c, 'theirs');
        return Math.max(1, sideLines);
    }

    /** 1-based first line of a chunk in a side text (base offset shifted by earlier chunks). */
    protected chunkStartIn(c: MergeChunk, side: 'ours' | 'theirs'): number {
        let shift = 0;
        for (const p of this.chunks) {
            if (p.index >= c.index) {
                break;
            }
            shift += chunkLines(p, side).length - p.base.length;
        }
        return c.baseStart + shift + 1;
    }

    protected regionRange(index: number): monaco.Range | undefined {
        const model = this.resultEditor?.getModel();
        const range = model?.getDecorationRange(this.regionIds[index]);
        return range ? new monaco.Range(range.startLineNumber, 1, range.endLineNumber, range.endLineNumber === range.startLineNumber && range.endColumn === 1 ? 1 : range.endColumn) : undefined;
    }

    /** Replaces a chunk's region in the Result with the chosen lines (one undo step). */
    protected setRegion(index: number, lines: readonly string[]): void {
        const editor = this.resultEditor;
        const model = editor?.getModel();
        const range = this.regionRange(index);
        if (!editor || !model || !range) {
            return;
        }
        const atEnd = range.endLineNumber > model.getLineCount() || (range.endLineNumber === model.getLineCount() && range.endColumn > 1);
        const text = lines.map(l => `${l}\n`).join('');
        const target = atEnd ? new monaco.Range(range.startLineNumber, 1, model.getLineCount(), model.getLineMaxColumn(model.getLineCount())) : range;
        editor.pushUndoStop();
        model.pushEditOperations([], [{ range: target, text: atEnd ? text.replace(/\n$/, '') : text }], () => null);
        this.regionIds[index] = model.deltaDecorations([this.regionIds[index]], [{
            range: new monaco.Range(range.startLineNumber, 1, range.startLineNumber + lines.length, 1),
            options: { stickiness: monaco.editor.TrackedRangeStickiness.NeverGrowsWhenTypingAtEdges }
        }])[0];
        editor.pushUndoStop();
    }

    protected choiceOf(c: MergeChunk): ChunkChoice {
        const s = this.state.get(c.index)!;
        return s.ours && s.theirs ? 'both' : s.ours ? 'ours' : s.theirs ? 'theirs' : 'base';
    }

    /** » / « : put Yours or Theirs into the Result; for a conflict, the second side is appended after the first. */
    apply(index: number, side: 'ours' | 'theirs'): void {
        const c = this.chunks[index];
        const s = this.state.get(index);
        if (!c || !s) {
            return;
        }
        s[side] = true;
        s.ignored = false;
        if (c.kind !== 'conflict') {
            s.ours = s.theirs = true;
        }
        this.setRegion(index, chunkLines(c, c.kind === 'conflict' ? this.choiceOf(c) : side));
    }

    /** × : keep the Result as it is for this chunk and mark it handled. */
    ignore(index: number): void {
        const s = this.state.get(index);
        if (s) {
            s.ignored = true;
            this.refresh();
        }
    }

    applyNonConflicting(): void {
        for (const c of this.chunks) {
            if (c.kind !== 'conflict' && !this.isResolved(c)) {
                this.apply(c.index, nonConflictingChoice(c) === 'theirs' ? 'theirs' : 'ours');
            }
        }
        this.refresh();
    }

    navigate(step: 1 | -1): void {
        const editor = this.resultEditor;
        const line = editor?.getPosition()?.lineNumber ?? 0;
        const open = this.chunks.filter(c => !this.isResolved(c)).map(c => this.regionRange(c.index)?.startLineNumber ?? 0);
        const target = step > 0 ? open.find(l => l > line) ?? open[0] : [...open].reverse().find(l => l < line) ?? open[open.length - 1];
        if (editor && target) {
            editor.setPosition({ lineNumber: target, column: 1 });
            editor.revealLineInCenter(target);
            editor.focus();
        }
    }

    protected decorate(): void {
        const kinds = (c: MergeChunk) => `ingot-merge-${c.kind}${this.isResolved(c) ? ' resolved' : ''}`;
        const side = (editor: monaco.editor.IStandaloneCodeEditor | undefined, which: 'ours' | 'theirs', key: string) => {
            if (!editor) {
                return;
            }
            const decorations = this.chunks.filter(c => which === 'ours' ? c.kind !== 'theirs' : c.kind !== 'ours').flatMap(c => {
                const start = this.chunkStartIn(c, which);
                const count = chunkLines(c, which).length;
                const marker = this.sideMarker(c, which);
                const out: monaco.editor.IModelDeltaDecoration[] = [];
                if (count) {
                    out.push({ range: new monaco.Range(start, 1, start + count - 1, 1), options: { isWholeLine: true, className: `ingot-merge-line ${kinds(c)}` } });
                }
                if (this.isOpen(c)) {
                    out.push({
                        range: new monaco.Range(marker, 1, marker, 1),
                        options: {
                            glyphMarginClassName: `ingot-merge-apply codicon ${which === 'ours' ? 'codicon-chevron-right' : 'codicon-chevron-left'}`,
                            glyphMarginHoverMessage: { value: which === 'ours' ? 'Apply yours to the result (»)' : 'Apply theirs to the result («)' },
                            linesDecorationsClassName: 'ingot-merge-ignore codicon codicon-close'
                        }
                    });
                } else if (!count) {
                    out.push({ range: new monaco.Range(marker, 1, marker, 1), options: { className: `ingot-merge-marker ${kinds(c)}` } });
                }
                return out;
            });
            (this.decorations[key] ??= editor.createDecorationsCollection()).set(decorations);
        };
        side(this.yoursEditor, 'ours', 'yours');
        side(this.theirsEditor, 'theirs', 'theirs');
        const result = this.resultEditor;
        if (result) {
            const decorations = this.chunks.flatMap(c => {
                const r = this.regionRange(c.index);
                if (!r) {
                    return [];
                }
                const end = Math.max(r.startLineNumber, r.endLineNumber - (r.endColumn === 1 && r.endLineNumber > r.startLineNumber ? 1 : 0));
                return [{ range: new monaco.Range(r.startLineNumber, 1, end, 1), options: { isWholeLine: true, className: `ingot-merge-line ${kinds(c)}${r.isEmpty() ? ' empty' : ''}` } }];
            });
            (this.decorations.result ??= result.createDecorationsCollection()).set(decorations);
        }
        this.node.dataset.conflicts = String(this.conflictsLeft);
        this.node.dataset.changes = String(this.changesLeft);
    }

    protected refresh(): void {
        this.decorate();
        this.renderBars();
    }

    get resultText(): string {
        return this.resultEditor?.getModel()?.getValue() ?? '';
    }

    /** Writes the Result to the file and marks it resolved (`git add`). */
    async save(): Promise<void> {
        const root = this.changes.root;
        const uri = this.changes.uriOf(this.path);
        if (!root || !uri) {
            return;
        }
        if (this.conflictsLeft > 0) {
            const ok = await new ConfirmDialog({
                title: 'Unresolved Conflicts', msg: `${this.conflictsLeft} conflict(s) are not resolved. Save the result and mark the file as resolved anyway?`, ok: 'Save and Finish', cancel: 'Continue Merge'
            }).open();
            if (!ok) {
                return;
            }
        }
        await this.files.write(uri, this.resultText);
        await this.git.run(root, { kind: 'add', paths: [this.path] });
        await this.changes.refresh();
        this.resolved?.();
        this.close();
    }

    async acceptSide(side: 'ours' | 'theirs'): Promise<void> {
        const root = this.changes.root;
        if (!root) {
            return;
        }
        await this.git.run(root, { kind: 'checkoutSide', side, paths: [this.path] });
        await this.git.run(root, { kind: 'add', paths: [this.path] });
        await this.changes.refresh();
        this.resolved?.();
        this.close();
    }

    /** Asks the first connected model for a merged file and shows it as a diff against the Result; nothing is applied automatically. */
    async resolveWithAi(): Promise<void> {
        const model = this.models.catalog.find(m => m.recommended && this.models.isModelConfigured(m.id)) ?? this.models.catalog.find(m => this.models.isModelConfigured(m.id));
        if (!model) {
            this.messages.info('Connect a model in Settings › Models to resolve conflicts with AI.');
            return;
        }
        this.aiBusy = true;
        this.renderBars();
        try {
            const reply = await this.models.stream(model.id, [
                { role: 'system', content: MERGE_AI_SYSTEM },
                { role: 'user', content: mergeAiPrompt(this.path, this.base, this.ours, this.theirs) }
            ], () => undefined).done;
            this.showProposal(extractMergedFile(reply));
        } catch (error) {
            this.messages.error(`AI merge failed: ${error instanceof Error ? error.message : String(error)}`);
        } finally {
            this.aiBusy = false;
            this.renderBars();
        }
    }

    protected showProposal(proposal: string): void {
        this.overlay.classList.add('open');
        let diff: monaco.editor.IStandaloneDiffEditor | undefined;
        const original = monaco.editor.createModel(this.resultText, this.resultEditor?.getModel()?.getLanguageId());
        const modified = monaco.editor.createModel(proposal, this.resultEditor?.getModel()?.getLanguageId());
        const close = () => {
            diff?.dispose();
            original.dispose();
            modified.dispose();
            this.overlay.classList.remove('open');
            this.overlayRoot.render(<></>);
        };
        this.overlayRoot.render(<div className='ingot-merge-proposal' id='ingot-merge-proposal'>
            <div className='ingot-merge-proposal-head'>
                <span className='codicon codicon-sparkle' /> AI proposal <span className='ingot-dim'>— Result (left) vs proposal (right). Nothing changes until you apply it.</span>
                <span className='ingot-flex' />
                <button type='button' id='ingot-merge-proposal-discard' className='theia-button secondary' onClick={close}>Discard</button>
                <button type='button' id='ingot-merge-proposal-apply' className='theia-button' onClick={() => {
                    const model = this.resultEditor?.getModel();
                    if (model && this.resultEditor) {
                        this.resultEditor.pushUndoStop();
                        model.pushEditOperations([], [{ range: model.getFullModelRange(), text: proposal }], () => null);
                        this.resultEditor.pushUndoStop();
                        this.chunks.forEach(c => { const s = this.state.get(c.index); if (s) { s.ignored = true; } });
                        this.refresh();
                    }
                    close();
                }}>Apply to Result</button>
            </div>
            <div className='ingot-merge-proposal-diff' ref={el => {
                if (el && !diff) {
                    diff = monaco.editor.createDiffEditor(el, { automaticLayout: true, readOnly: true, originalEditable: false, minimap: { enabled: false }, renderSideBySide: true, useInlineViewWhenSpaceIsLimited: false });
                    diff.setModel({ original, modified });
                }
            }} />
        </div>);
    }

    protected renderBars(): void {
        const tool = (id: string, icon: string, title: string, onClick: () => void, disabled = false) =>
            <button type='button' id={`ingot-merge-${id}`} className='ingot-lc-tool' title={title} aria-label={title} disabled={disabled} onClick={onClick}><span className={`codicon codicon-${icon}`} /></button>;
        const conflicts = this.conflictsLeft;
        const changes = this.changesLeft;
        this.toolbarRoot.render(<div className='ingot-merge-tools' role='toolbar'>
            {tool('prev', 'arrow-up', 'Previous Change', () => this.navigate(-1))}
            {tool('next', 'arrow-down', 'Next Change', () => this.navigate(1))}
            <span className='ingot-lc-sep' />
            <button type='button' id='ingot-merge-apply-nonconflicting' className='ingot-btn-ghost' disabled={!changes} title='Apply All Non-Conflicting Changes'
                onClick={() => this.applyNonConflicting()}><span className='codicon codicon-wand' /> Apply non-conflicting</button>
            <button type='button' id='ingot-merge-ai' className='ingot-btn-ghost' disabled={this.aiBusy} title='Ask a model for a merged file (shown as a diff first)'
                onClick={() => this.resolveWithAi()}><span className={`codicon ${this.aiBusy ? 'codicon-loading codicon-modifier-spin' : 'codicon-sparkle'}`} /> Resolve with AI</button>
            <span className='ingot-flex' />
            <span id='ingot-merge-status' className='ingot-merge-status'>
                {conflicts ? `${conflicts} conflict${conflicts === 1 ? '' : 's'}` : 'All conflicts resolved'}{changes ? ` · ${changes} change${changes === 1 ? '' : 's'} left` : ''}
            </span>
        </div>);
        this.footerRoot.render(<div className='ingot-merge-buttons'>
            <button type='button' id='ingot-merge-accept-ours' className='theia-button secondary' onClick={() => this.acceptSide('ours')}>Accept Yours</button>
            <button type='button' id='ingot-merge-accept-theirs' className='theia-button secondary' onClick={() => this.acceptSide('theirs')}>Accept Theirs</button>
            <span className='ingot-flex' />
            <button type='button' id='ingot-merge-cancel' className='theia-button secondary' onClick={() => this.close()}>Cancel</button>
            <button type='button' id='ingot-merge-save' className='theia-button' onClick={() => this.save()}>Apply</button>
        </div>);
    }

    /** For tests and tooling: the merged text a choice would give, independent of manual edits. */
    preview(choose: (c: MergeChunk) => ChunkChoice): string {
        return buildMerged(this.base, this.chunks, choose);
    }

    /** Number of lines in a text (tooltips). */
    static lines(text: string): number {
        return splitText(text).length;
    }
}
