import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import type { Reference as IReference } from '@theia/core/lib/common/reference';
import URI from '@theia/core/lib/common/uri';
import { ContextKeyService, type ContextKey } from '@theia/core/lib/browser/context-key-service';
import { close as widgetClose } from '@theia/core/lib/browser/saveable';
import { EditorManager, type EditorOpenerOptions } from '@theia/editor/lib/browser/editor-manager';
import type { EditorWidget } from '@theia/editor/lib/browser/editor-widget';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import type { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import { MonacoTextModelService } from '@theia/monaco/lib/browser/monaco-text-model-service';
import * as monaco from '@theia/monaco-editor-core';
import { CHANGES_PENDING_KEY, STREAM_APPLY_MS } from '../../common/changes/changes.consts';
import type { ChangeHunk, Checkpoint, CodeChange, HunkState, RejectedHunksEvent } from '../../common/changes/changes.types';
import { buildHunks, changeStats, composeText, decide, hunkLines, isPending, streamingPreview } from '../../common/changes/changes.utils';
import { ACCEPT_EDIT_KEY_LABEL, REJECT_EDIT_KEY_LABEL } from './changes.browser-consts';
import { formatCountdown } from '../../common/review/review';

/** Last markup per review bar. */
const barHtml = new WeakMap<HTMLElement, string>();
const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/** Where an edit comes from: the chat, the agent message it renders under, and the user message it answers. */
export interface ChangeOrigin {
    readonly sessionId: string;
    readonly messageIndex: number;
    readonly userIndex: number;
}

interface EditorView {
    readonly control: monaco.editor.ICodeEditor;
    readonly decorations: monaco.editor.IEditorDecorationsCollection;
    readonly zoneIds: string[];
    readonly overlays: monaco.editor.IOverlayWidget[];
    readonly listeners: { dispose(): void }[];
    readonly bar?: HTMLElement;
}

/** A paused run as the floating review bar shows it (IDEA-105). */
export interface ReviewBarPause {
    readonly applied: number;
    readonly total: number;
    readonly continueAt?: number;
    readonly onContinue: () => void;
}

interface StreamState {
    partial: string;
    timer?: ReturnType<typeof setTimeout>;
    typedLines: number;
}

/**
 * Agent code changes (IDEA-102): edits stream live into the editor, then every hunk waits for Accept / Reject
 * (CodeLens-style rows in the editor and buttons in the chat block). Decided files are saved; checkpoints let any
 * user message "Revert to here".
 */
@injectable()
export class ChangeTracker {

    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(MonacoTextModelService) protected readonly textModels: MonacoTextModelService;
    @inject(FileService) protected readonly files: FileService;
    @inject(ContextKeyService) protected readonly contextKeys: ContextKeyService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;
    protected readonly onDidRejectHunksEmitter = new Emitter<RejectedHunksEvent>();
    /** IDEA-328: hunks the user rejected (one event per decision), for learned rules. */
    readonly onDidRejectHunks: Event<RejectedHunksEvent> = this.onDidRejectHunksEmitter.event;

    protected items: CodeChange[] = [];
    protected checkpointList: Checkpoint[] = [];
    protected readonly refs = new Map<string, Promise<IReference<MonacoEditorModel>>>();
    protected readonly views = new Map<string, EditorView[]>();
    /** IDEA-105: a paused agent run, shown inline in the floating review bar. */
    protected pause?: ReviewBarPause;
    protected pauseTicker?: ReturnType<typeof setInterval>;
    protected readonly streams = new Map<string, StreamState>();
    protected pendingKey?: ContextKey<boolean>;
    protected counter = 0;
    /** In-flight beginStream per session + file, so a finalize that arrives first lands on the same change. */
    protected readonly starting = new Map<string, Promise<string>>();
    /** The one preview tab agent edits replace. A click in the change list pins that file and leaves this slot. */
    protected agentPreview?: EditorWidget;
    /** Files the user opened from the change list. Later edits must not close them. */
    protected readonly pinned = new Set<string>();
    /** Serializes preview replacement so two files never open two tabs. */
    protected previewQueue: Promise<unknown> = Promise.resolve();

    @postConstruct()
    protected init(): void {
        this.editors.onCreated(widget => this.redrawUri(widget.editor.uri.toString()));
        this.editors.onCurrentEditorChanged(() => this.redrawAll());
    }

    get changes(): readonly CodeChange[] {
        return this.items;
    }

    get checkpoints(): readonly Checkpoint[] {
        return this.checkpointList;
    }

    find(id: string): CodeChange | undefined {
        return this.items.find(c => c.id === id);
    }

    forMessage(sessionId: string, messageIndex: number): CodeChange[] {
        return this.items.filter(c => c.sessionId === sessionId && c.messageIndex === messageIndex);
    }

    /** IDEA-105: the files of a chat's latest run that changed files (the review list). */
    lastRun(sessionId: string): CodeChange[] {
        const mine = this.items.filter(c => c.sessionId === sessionId);
        const last = Math.max(-1, ...mine.map(c => c.messageIndex));
        return mine.filter(c => c.messageIndex === last);
    }

    pending(sessionId?: string): CodeChange[] {
        return this.items.filter(c => isPending(c) && (!sessionId || c.sessionId === sessionId));
    }

    /** Sessions that already have a change for this path, including a live stream. */
    sessionsTouching(path: string): readonly string[] {
        return [...new Set(this.items.filter(change => change.path === path).map(change => change.sessionId))];
    }

    /** Starts (or continues) the live view of an edit that is still streaming. */
    beginStream(origin: ChangeOrigin, path: string, uri: URI): Promise<string> {
        const key = `${origin.sessionId}\u0000${path}`;
        const inFlight = this.starting.get(key);
        if (inFlight) {
            return inFlight;
        }
        const started = this.doBeginStream(origin, path, uri).finally(() => this.starting.delete(key));
        this.starting.set(key, started);
        return started;
    }

    protected async doBeginStream({ sessionId, messageIndex, userIndex }: ChangeOrigin, path: string, uri: URI): Promise<string> {
        const existing = this.items.find(c => c.sessionId === sessionId && c.path === path && c.status === 'streaming');
        if (existing) {
            return existing.id;
        }
        await this.settleEarlier(uri.toString());
        const { text, created } = await this.readOrCreate(uri);
        this.checkpoint(sessionId, userIndex, uri.toString(), created ? undefined : text);
        const id = `chg${++this.counter}`;
        this.items = [...this.items, { id, sessionId, messageIndex, path, uri: uri.toString(), oldText: text, newText: text, created, hunks: [], status: 'streaming' }];
        this.streams.set(id, { partial: '', typedLines: 0 });
        await this.revealFile(uri);
        this.fire();
        return id;
    }

    /** Pushes the content typed so far (throttled) so the editor shows the edit being written. */
    stream(id: string, partial: string): void {
        const state = this.streams.get(id);
        if (!state) {
            return;
        }
        state.partial = partial;
        state.timer ??= setTimeout(async () => {
            state.timer = undefined;
            const change = this.find(id);
            if (!change || change.status !== 'streaming') {
                return;
            }
            const preview = streamingPreview(change.oldText, state.partial);
            state.typedLines = state.partial.split('\n').length;
            await this.applyText(change, preview, false);
            this.replace({ ...change, newText: preview, hunks: buildHunks(change.oldText, preview, `${id}-h`) });
        }, STREAM_APPLY_MS);
    }

    /** Write the open model's text to disk without clearing a pending review. */
    async persist(uri: string): Promise<void> {
        const pending = this.refs.get(uri);
        if (!pending) {
            return;
        }
        const ref = await pending;
        await ref.object.save();
    }

    /** The edit is complete: apply the final text and wait for per-hunk decisions. */
    async finalize({ sessionId, messageIndex, userIndex }: ChangeOrigin, path: string, uri: URI, newText: string): Promise<CodeChange> {
        await this.starting.get(`${sessionId}\u0000${path}`)?.catch(() => undefined);
        let change = this.items.find(c => c.sessionId === sessionId && c.path === path && c.status === 'streaming');
        if (!change) {
            await this.settleEarlier(uri.toString());
            const { text, created } = await this.readOrCreate(uri);
            this.checkpoint(sessionId, userIndex, uri.toString(), created ? undefined : text);
            change = { id: `chg${++this.counter}`, sessionId, messageIndex, path, uri: uri.toString(), oldText: text, newText: text, created, hunks: [], status: 'streaming' };
            this.items = [...this.items, change];
        }
        const state = this.streams.get(change.id);
        if (state?.timer) {
            clearTimeout(state.timer);
        }
        this.streams.delete(change.id);
        const hunks = buildHunks(change.oldText, newText, `${change.id}-h`);
        const final: CodeChange = { ...change, messageIndex, newText, hunks, status: hunks.length ? 'applied' : 'accepted' };
        await this.applyText(final, newText, true);
        this.replace(final);
        if (!hunks.length) {
            await this.settle(final);
        }
        await this.revealFile(uri);
        this.redrawUri(final.uri);
        return final;
    }

    /** IDEA-180: drop one streaming edit (a file the Harmony lock gave to another agent) and put the file back. */
    async cancelStream(sessionId: string, path: string): Promise<void> {
        for (const change of this.items.filter(c => c.sessionId === sessionId && c.path === path && c.status === 'streaming')) {
            this.streams.delete(change.id);
            await this.applyText(change, change.oldText, false);
            await this.settle({ ...change, hunks: [], status: 'rejected' });
            this.items = this.items.filter(c => c.id !== change.id);
        }
        this.fire();
    }

    /** Stop / error while an edit streams: put the file back. */
    async cancelStreams(sessionId: string): Promise<void> {
        for (const change of this.items.filter(c => c.sessionId === sessionId && c.status === 'streaming')) {
            this.streams.delete(change.id);
            await this.applyText(change, change.oldText, false);
            await this.settle({ ...change, hunks: [], status: 'rejected' });
            this.items = this.items.filter(c => c.id !== change.id);
        }
        this.fire();
    }

    async decide(id: string, hunkIds: readonly string[] | 'all', state: HunkState): Promise<void> {
        const change = this.find(id);
        if (!change || change.status === 'streaming') {
            return;
        }
        const next = decide(change, hunkIds, state);
        const rejected = state === 'rejected' ? change.hunks.filter(h => h.state === 'pending' && (hunkIds === 'all' || hunkIds.includes(h.id))) : [];
        this.replace(next);
        if (rejected.length) {
            this.onDidRejectHunksEmitter.fire({ sessionId: change.sessionId, path: change.path, hunks: rejected });
        }
        if (!isPending(next)) {
            await this.settle(next);
        } else {
            await this.applyText(next, composeText(next.oldText, next.hunks), true);
            this.redrawUri(next.uri);
        }
        this.fire();
    }

    async decideAll(state: HunkState, sessionId?: string): Promise<void> {
        for (const change of this.pending(sessionId).filter(c => c.status !== 'streaming')) {
            await this.decide(change.id, 'all', state);
        }
    }

    /** Ctrl+Y / Ctrl+N: the file in the active editor, else the first file waiting. */
    async decideCurrentFile(state: HunkState): Promise<void> {
        const change = this.currentChange();
        if (change) {
            await this.decide(change.id, 'all', state);
        }
    }

    currentChange(): CodeChange | undefined {
        const uri = this.editors.currentEditor?.editor.uri.toString();
        const pending = this.pending().filter(c => c.status !== 'streaming');
        return pending.find(c => c.uri === uri) ?? pending[0];
    }

    /**
     * Opens the file and scrolls to the hunk (or the first pending one).
     * `pin` keeps the tab (a click in the change list). Stepping files replaces the one preview tab.
     */
    async reveal(id: string, hunkId?: string, pin = false): Promise<void> {
        const change = this.find(id);
        if (!change) {
            return;
        }
        const target = change.hunks.find(h => h.id === hunkId) ?? change.hunks.find(h => h.state === 'pending') ?? change.hunks[0];
        const line = target ? (hunkLines(change.hunks).get(target.id)?.start ?? 0) : 0;
        const uri = new URI(change.uri);
        let widget: EditorWidget | undefined;
        if (pin) {
            this.pinned.add(change.uri);
            if (this.agentPreview?.editor.uri.toString() === change.uri) {
                this.agentPreview = undefined;
            }
            widget = await this.openEditor(uri, {
                mode: 'activate', preview: false,
                selection: { start: { line, character: 0 }, end: { line, character: 0 } }
            });
        } else {
            await this.revealFile(uri);
            widget = this.editors.all.find(editor => editor.editor.uri.toString() === change.uri);
        }
        if (widget?.editor instanceof MonacoEditor) {
            const control = widget.editor.getControl();
            control.setPosition({ lineNumber: line + 1, column: 1 });
            control.revealLineInCenter(line + 1);
        }
    }

    /** ⌥↓ / ⌥↑: next / previous pending hunk, across files. */
    async navigate(direction: 1 | -1): Promise<void> {
        const stops = this.pending().filter(c => c.status !== 'streaming')
            .flatMap(c => c.hunks.filter(h => h.state === 'pending').map(h => ({ change: c, hunk: h, line: hunkLines(c.hunks).get(h.id)?.start ?? 0 })));
        if (!stops.length) {
            return;
        }
        const editor = this.editors.currentEditor;
        const uri = editor?.editor.uri.toString();
        const cursor = editor?.editor.cursor.line ?? -1;
        const here = stops.map((s, i) => ({ s, i })).filter(({ s }) => s.change.uri === uri);
        let index: number;
        if (direction > 0) {
            index = here.find(({ s }) => s.line > cursor)?.i ?? ((here.at(-1)?.i ?? -1) + 1) % stops.length;
        } else {
            index = [...here].reverse().find(({ s }) => s.line < cursor)?.i ?? (((here[0]?.i ?? 0) - 1) + stops.length) % stops.length;
        }
        const stop = stops[index];
        await this.reveal(stop.change.id, stop.hunk.id);
    }

    /** Remembers a file's content before an agent run touches it (first snapshot per run wins). */
    checkpoint(sessionId: string, messageIndex: number, uri: string, text: string | undefined): void {
        const existing = this.checkpointList.find(c => c.sessionId === sessionId && c.messageIndex === messageIndex);
        if (existing && uri in existing.files) {
            return;
        }
        const files = { ...(existing?.files ?? {}), [uri]: text };
        this.checkpointList = [...this.checkpointList.filter(c => c !== existing), { sessionId, messageIndex, files }];
    }

    hasCheckpointFrom(sessionId: string, messageIndex: number): boolean {
        return this.checkpointList.some(c => c.sessionId === sessionId && c.messageIndex >= messageIndex);
    }

    /** "Revert to here": every file the agent touched from this message on goes back to how it was. */
    async revertTo(sessionId: string, messageIndex: number, plan: Map<string, string | undefined>): Promise<void> {
        for (const change of this.items.filter(c => c.sessionId === sessionId && c.messageIndex >= messageIndex)) {
            this.streams.delete(change.id);
            this.clearViews(change.id);
            await this.release(change.id);
        }
        this.items = this.items.filter(c => !(c.sessionId === sessionId && c.messageIndex >= messageIndex));
        for (const [raw, text] of plan) {
            const uri = new URI(raw);
            if (text === undefined) {
                await this.files.delete(uri).catch(() => undefined);
                continue;
            }
            const ref = await this.textModels.createModelReference(uri);
            try {
                const model = ref.object.textEditorModel;
                model.pushEditOperations([], [{ range: model.getFullModelRange(), text }], () => null);
                await ref.object.save();
            } finally {
                ref.dispose();
            }
        }
        this.checkpointList = this.checkpointList.filter(c => !(c.sessionId === sessionId && c.messageIndex >= messageIndex));
        this.fire();
    }

    /** Text in an open editor model, including an unsaved or pending edit. Undefined when the file is not open. */
    async bufferText(uri: string): Promise<string | undefined> {
        const ref = await this.refs.get(uri)?.catch(() => undefined);
        return ref?.object.textEditorModel.getValue();
    }

    stats(change: CodeChange): { added: number; removed: number } {
        return changeStats(change.hunks);
    }

    /**
     * Opens the file in the editor it already has, wherever that is. Theia only reuses an editor found in the target tab
     * bar, so with no current editor (focus in the chat, empty main area) every open made a new widget for the same file;
     * the duplicates then closed each other with a "save changes?" prompt while an edit waited for review.
     */
    protected openEditor(uri: URI, options: EditorOpenerOptions): Promise<EditorWidget> {
        const existing = this.editors.all.find(w => w.editor.uri.toString() === uri.toString());
        const counter = existing ? Number(existing.id.slice(existing.id.lastIndexOf(':') + 1)) : NaN;
        return this.editors.open(uri, Number.isFinite(counter) ? { ...options, counter } : options);
    }

    /** Opens the file in the single agent preview tab. The previous preview is closed without saving or reverting. */
    protected revealFile(uri: URI): Promise<unknown> {
        const next = this.previewQueue.then(() => this.openRollingPreview(uri)).catch(() => undefined);
        this.previewQueue = next;
        return next;
    }

    protected async openRollingPreview(uri: URI): Promise<void> {
        const key = uri.toString();
        if (this.pinned.has(key)) {
            await this.openEditor(uri, { mode: 'reveal', preview: false });
            return;
        }
        const existing = this.editors.all.find(widget => widget.editor.uri.toString() === key);
        if (existing && existing !== this.agentPreview) {
            await this.openEditor(uri, { mode: 'reveal' });
            return;
        }
        const previous = this.agentPreview;
        if (previous && !previous.isDisposed && previous.editor.uri.toString() !== key) {
            this.agentPreview = undefined;
            this.dropPreview(previous);
        }
        this.agentPreview = await this.openEditor(uri, { mode: 'reveal', preview: true });
    }

    /** Closes the rolling preview without a save prompt and without putting the pending edit back. */
    protected dropPreview(widget: EditorWidget): void {
        const uri = widget.editor.uri.toString();
        for (const change of this.items.filter(item => item.uri === uri)) {
            this.clearViews(change.id);
        }
        const host = widget as EditorWidget & { [widgetClose]?: () => void };
        const dispose = host[widgetClose];
        if (dispose) {
            dispose.call(widget);
            return;
        }
        widget.close();
    }

    protected async readOrCreate(uri: URI): Promise<{ text: string; created: boolean }> {
        if (await this.files.exists(uri)) {
            const ref = await this.refFor(uri.toString());
            return { text: ref.object.textEditorModel.getValue(), created: false };
        }
        await this.files.create(uri, '');
        return { text: '', created: true };
    }

    /** A new edit to a file that still waits for review keeps the earlier one (its text is the new base). */
    protected async settleEarlier(uri: string): Promise<void> {
        for (const change of this.items.filter(c => c.uri === uri && isPending(c) && c.status !== 'streaming')) {
            await this.decide(change.id, 'all', 'accepted');
        }
    }

    protected refFor(uri: string): Promise<IReference<MonacoEditorModel>> {
        let ref = this.refs.get(uri);
        if (!ref) {
            // The tracker opens the editor itself (revealFile): without this, Theia's "open an editor when a model with no
            // editor gets dirty" raced it and the two editors for one file closed each other with a save prompt.
            ref = this.textModels.createModelReference(new URI(uri)).then(r => {
                r.object.suppressOpenEditorWhenDirty = true;
                return r;
            });
            this.refs.set(uri, ref);
        }
        return ref;
    }

    protected async release(id: string): Promise<void> {
        const change = this.find(id);
        if (!change || this.items.some(c => c.id !== id && c.uri === change.uri && isPending(c))) {
            return;
        }
        const ref = await this.refs.get(change.uri)?.catch(() => undefined);
        this.refs.delete(change.uri);
        if (ref) {
            ref.object.suppressOpenEditorWhenDirty = false;
            ref.dispose();
        }
    }

    protected async applyText(change: CodeChange, text: string, undoable: boolean): Promise<void> {
        const ref = await this.refFor(change.uri);
        const model = ref.object.textEditorModel;
        if (model.getValue() === text) {
            return;
        }
        const edit = [{ range: model.getFullModelRange(), text }];
        if (undoable) {
            model.pushEditOperations([], edit, () => null);
        } else {
            model.applyEdits(edit);
        }
    }

    /** Every hunk decided: write the composed text and save, or remove a created file that was rejected. */
    protected async settle(change: CodeChange): Promise<void> {
        this.clearViews(change.id);
        if (change.created && change.status === 'rejected') {
            await this.release(change.id);
            for (const widget of this.editors.all.filter(w => w.editor.uri.toString() === change.uri)) {
                widget.close();
            }
            await this.files.delete(new URI(change.uri)).catch(() => undefined);
        } else {
            const ref = await this.refFor(change.uri);
            await this.applyText(change, composeText(change.oldText, change.hunks), true);
            await ref.object.save();
            await this.release(change.id);
        }
        this.fire();
    }

    protected replace(change: CodeChange): void {
        this.items = this.items.map(c => c.id === change.id ? change : c);
        this.redrawUri(change.uri);
        this.fire();
    }

    protected fire(): void {
        this.pendingKey ??= this.contextKeys.createKey<boolean>(CHANGES_PENDING_KEY, false);
        this.pendingKey.set(this.items.some(c => isPending(c) && c.status !== 'streaming'));
        this.refreshBars();
        this.onDidChangeEmitter.fire();
    }

    /** IDEA-105: the agent store reports a paused run (or undefined when it continues) for the review bar. */
    setPause(pause: ReviewBarPause | undefined): void {
        this.pause = pause;
        clearInterval(this.pauseTicker);
        this.pauseTicker = pause?.continueAt !== undefined ? setInterval(() => this.refreshBars(), 500) : undefined;
        this.refreshBars();
    }

    /** Re-renders every open review bar (file counts, pause countdown). */
    protected refreshBars(): void {
        for (const [id, views] of this.views) {
            const change = this.find(id);
            views.forEach(v => v.bar && change && this.renderBar(v.bar, change));
        }
    }

    /** Previous / next changed file (the review bar's ‹ ›). */
    async stepFile(fromId: string, direction: 1 | -1): Promise<void> {
        const files = this.pending().filter(c => c.status !== 'streaming');
        const at = files.findIndex(c => c.id === fromId);
        const next = files[((at < 0 ? 0 : at) + direction + files.length) % files.length];
        if (next) {
            await this.reveal(next.id);
        }
    }

    protected redrawAll(): void {
        new Set(this.items.filter(isPending).map(c => c.uri)).forEach(uri => this.redrawUri(uri));
    }

    protected redrawUri(uri: string): void {
        for (const change of this.items.filter(c => c.uri === uri)) {
            this.clearViews(change.id);
            if (!isPending(change)) {
                continue;
            }
            const views = this.editors.all.filter(w => w.editor.uri.toString() === uri && w.editor instanceof MonacoEditor)
                .map(w => this.draw(change, w));
            this.views.set(change.id, views);
        }
    }

    protected clearViews(id: string): void {
        for (const view of this.views.get(id) ?? []) {
            view.decorations.clear();
            view.control.changeViewZones(accessor => view.zoneIds.forEach(z => accessor.removeZone(z)));
            view.overlays.forEach(o => view.control.removeOverlayWidget(o));
            view.listeners.forEach(l => l.dispose());
            view.bar?.remove();
        }
        this.views.delete(id);
    }

    protected draw(change: CodeChange, widget: EditorWidget): EditorView {
        const control = (widget.editor as MonacoEditor).getControl();
        const positions = hunkLines(change.hunks);
        const pendingHunks = change.hunks.filter(h => h.state === 'pending');
        const streaming = change.status === 'streaming';
        const decorations: monaco.editor.IModelDeltaDecoration[] = [];
        for (const hunk of streaming ? change.hunks : pendingHunks) {
            const at = positions.get(hunk.id);
            for (let i = 0; at && i < at.length; i++) {
                decorations.push({ range: new monaco.Range(at.start + i + 1, 1, at.start + i + 1, 1), options: { isWholeLine: true, className: 'ingot-diff-added-line', linesDecorationsClassName: 'ingot-diff-added-gutter' } });
            }
        }
        // The animated </> mark marks where the agent is typing; once applied it settles on each hunk.
        if (streaming) {
            const line = Math.max(1, this.streams.get(change.id)?.typedLines ?? 1);
            decorations.push({ range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: 'ingot-diff-streaming-line', glyphMarginClassName: 'ingot-gutter-mark ingot-gutter-mark-live', linesDecorationsClassName: 'ingot-gutter-mark ingot-gutter-mark-live' } });
            if ((control.getModel()?.getLineCount() ?? 0) >= line) {
                control.revealLineInCenterIfOutsideViewport(line);
            }
        } else {
            for (const hunk of pendingHunks) {
                const start = (positions.get(hunk.id)?.start ?? 0) + 1;
                decorations.push({ range: new monaco.Range(start, 1, start, 1), options: { glyphMarginClassName: 'ingot-gutter-mark', glyphMarginHoverMessage: { value: 'Agent change' } } });
            }
        }
        const collection = control.createDecorationsCollection(decorations);
        const zoneIds: string[] = [];
        const overlays: monaco.editor.IOverlayWidget[] = [];
        const listeners: { dispose(): void }[] = [];
        if (!streaming) {
            // The removed lines live in a view zone; the Accept / Reject row is an overlay widget on top of it,
            // because Monaco's text layer sits above view zones and would swallow the clicks.
            const rows: { node: HTMLElement; line: number; height: number }[] = [];
            control.changeViewZones(accessor => {
                for (const hunk of pendingHunks) {
                    const start = positions.get(hunk.id)?.start ?? 0;
                    const heightInLines = 1 + hunk.removed.length;
                    zoneIds.push(accessor.addZone({ afterLineNumber: start, heightInLines, domNode: this.hunkZone(hunk, control.getOption(monaco.editor.EditorOption.lineHeight)), suppressMouseDown: true }));
                    const node = this.hunkActions(change, hunk);
                    const overlay: monaco.editor.IOverlayWidget = { getId: () => `ingot.hunk.${change.id}.${hunk.id}`, getDomNode: () => node, getPosition: () => null };
                    control.addOverlayWidget(overlay);
                    overlays.push(overlay);
                    rows.push({ node, line: start + 1, height: heightInLines });
                }
            });
            const place = (): void => {
                const lineHeight = control.getOption(monaco.editor.EditorOption.lineHeight);
                const layout = control.getLayoutInfo();
                const lines = control.getModel()?.getLineCount() ?? 0;
                for (const row of rows) {
                    // The zone sits right above `row.line` (or below the last line when the hunk ends the file).
                    const below = row.line > lines ? control.getTopForLineNumber(lines) + lineHeight : control.getTopForLineNumber(row.line);
                    const top = below - row.height * lineHeight - control.getScrollTop();
                    const visible = top > -lineHeight && top < layout.height - lineHeight;
                    row.node.style.display = visible ? '' : 'none';
                    row.node.style.top = `${top}px`;
                    row.node.style.left = `${layout.contentLeft}px`;
                    row.node.style.height = `${lineHeight}px`;
                }
            };
            listeners.push(control.onDidScrollChange(place), control.onDidLayoutChange(place), control.onDidChangeModelContent(place));
            place();
            requestAnimationFrame(place);
        }
        const bar = streaming ? undefined : this.fileBar(change);
        if (bar) {
            widget.node.appendChild(bar);
        }
        return { control, decorations: collection, zoneIds, overlays, listeners, bar };
    }

    /** CodeLens-style row above a hunk: Accept / Reject and the +/− counts (an overlay widget). */
    protected hunkActions(change: CodeChange, hunk: ChangeHunk): HTMLElement {
        const actions = document.createElement('div');
        actions.className = 'ingot-hunk-actions';
        const button = (label: string, cls: string, id: string, state: HunkState): HTMLButtonElement => {
            const b = document.createElement('button');
            b.type = 'button';
            b.id = id;
            b.className = cls;
            b.textContent = label;
            b.addEventListener('mousedown', e => e.stopPropagation());
            b.addEventListener('click', e => {
                e.preventDefault();
                e.stopPropagation();
                this.decide(change.id, [hunk.id], state);
            });
            return b;
        };
        actions.append(
            button('Accept', 'ingot-hunk-accept', `ingot-hunk-accept-${hunk.id}`, 'accepted'),
            button('Reject', 'ingot-hunk-reject', `ingot-hunk-reject-${hunk.id}`, 'rejected')
        );
        const counts = document.createElement('span');
        counts.className = 'ingot-hunk-counts';
        counts.innerHTML = `<span class="ingot-plus">+${hunk.added.length}</span> <span class="ingot-minus">−${hunk.removed.length}</span>`;
        actions.append(counts);
        return actions;
    }

    /** The view zone above a hunk: room for the action row, then the removed lines in red. */
    protected hunkZone(hunk: ChangeHunk, lineHeight: number): HTMLElement {
        const node = document.createElement('div');
        node.className = 'ingot-hunk-zone';
        const spacer = document.createElement('div');
        spacer.className = 'ingot-hunk-spacer';
        spacer.style.height = `${lineHeight}px`;
        node.append(spacer);
        if (hunk.removed.length) {
            const removed = document.createElement('div');
            removed.className = 'ingot-diff-removed-zone';
            for (const line of hunk.removed) {
                const row = document.createElement('div');
                row.className = 'ingot-diff-removed-line';
                row.textContent = line || ' ';
                removed.appendChild(row);
            }
            node.append(removed);
        }
        return node;
    }

    /**
     * IDEA-105 floating review bar, bottom-right of the editor: "X of Y files" with ‹ › to step files and ↑ ↓ to step
     * changes, Reject / Accept for this file (Ctrl+N / Ctrl+Y), Reject All / Accept All, and a paused run's countdown.
     */
    protected fileBar(change: CodeChange): HTMLElement {
        const bar = document.createElement('div');
        bar.className = 'ingot-agent-edit-bar';
        bar.setAttribute('role', 'toolbar');
        bar.setAttribute('aria-label', 'Review agent changes');
        bar.addEventListener('click', event => {
            const action = (event.target as HTMLElement).closest<HTMLElement>('[data-action]')?.dataset.action;
            const current = this.find(change.id);
            switch (action) {
                case 'prev-file': void this.stepFile(change.id, -1); break;
                case 'next-file': void this.stepFile(change.id, 1); break;
                case 'prev-change': void this.navigate(-1); break;
                case 'next-change': void this.navigate(1); break;
                case 'reject': void this.decide(change.id, 'all', 'rejected'); break;
                case 'accept': void this.decide(change.id, 'all', 'accepted'); break;
                case 'reject-all': void this.decideAll('rejected', current?.sessionId); break;
                case 'accept-all': void this.decideAll('accepted', current?.sessionId); break;
                case 'continue': this.pause?.onContinue(); break;
            }
        });
        this.renderBar(bar, change);
        return bar;
    }

    protected renderBar(bar: HTMLElement, change: CodeChange): void {
        const stats = changeStats(change.hunks.filter(h => h.state === 'pending'));
        const files = this.pending(change.sessionId).filter(c => c.status !== 'streaming');
        const index = Math.max(0, files.findIndex(c => c.id === change.id));
        const name = escapeHtml(new URI(change.uri).path.base);
        const pause = this.pause;
        const left = pause?.continueAt !== undefined ? Math.max(0, (pause.continueAt - Date.now()) / 1000) : undefined;
        const icon = (codicon: string, action: string, title: string): string =>
            `<button type="button" class="ingot-rb-icon codicon codicon-${codicon}" data-action="${action}" title="${title}" aria-label="${title}"></button>`;
        const html = `
            ${pause ? `<span class="ingot-rb-pause" title="${pause.applied} of ${pause.total} files applied. Pause for review?"><span class="codicon codicon-debug-pause"></span>`
                + `${left !== undefined ? '<span class="ingot-rb-countdown"></span>' : '<span>Paused</span>'}`
                + `<button type="button" class="ingot-rb-continue" data-action="continue">Continue</button></span><span class="ingot-rb-sep"></span>` : ''}
            <span class="ingot-rb-files">
                ${files.length > 1 ? icon('chevron-left', 'prev-file', 'Previous file') : ''}
                <span class="ingot-rb-count" title="${name} +${stats.added} −${stats.removed}">${files.length > 1
                    ? `<span class="ingot-rb-of">${index + 1} of ${files.length} files</span>`
                    : `<span class="ingot-agent-edit-file">${name}</span> <span class="ingot-plus">+${stats.added}</span> <span class="ingot-minus">−${stats.removed}</span>`}</span>
                ${files.length > 1 ? icon('chevron-right', 'next-file', 'Next file') : ''}
            </span>
            <span class="ingot-rb-sep"></span>
            ${icon('arrow-up', 'prev-change', 'Previous change (⌥↑)')}${icon('arrow-down', 'next-change', 'Next change (⌥↓)')}
            <span class="ingot-rb-sep"></span>
            <button type="button" class="ingot-agent-edit-reject" data-action="reject" title="Reject this file (${REJECT_EDIT_KEY_LABEL})">Reject${files.length > 1 ? '' : ` <kbd>${REJECT_EDIT_KEY_LABEL}</kbd>`}</button>
            <button type="button" class="ingot-agent-edit-accept" data-action="accept" title="Accept this file (${ACCEPT_EDIT_KEY_LABEL})">Accept${files.length > 1 ? '' : ` <kbd>${ACCEPT_EDIT_KEY_LABEL}</kbd>`}</button>
            ${files.length > 1 ? `<span class="ingot-rb-sep"></span><button type="button" class="ingot-rb-all" data-action="reject-all">Reject All</button><button type="button" class="ingot-rb-all ingot-rb-all-accept" data-action="accept-all">Accept All</button>` : ''}`;
        // Only rebuild when something but the countdown changed, so a click in progress never loses its button.
        if (barHtml.get(bar) !== html) {
            bar.innerHTML = html;
            barHtml.set(bar, html);
        }
        const countdown = bar.querySelector('.ingot-rb-countdown');
        if (countdown && left !== undefined) {
            countdown.textContent = formatCountdown(left);
        }
    }

}
