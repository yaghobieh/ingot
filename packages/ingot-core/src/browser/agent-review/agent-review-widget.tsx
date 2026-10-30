import * as React from '@theia/core/shared/react';
import { createRoot, type Root } from '@theia/core/shared/react-dom/client';
import * as monaco from '@theia/monaco-editor-core';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { BaseWidget, type Message } from '@theia/core/lib/browser';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import type { Reference as IReference } from '@theia/core/lib/common/reference';
import URI from '@theia/core/lib/common/uri';
import type { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import { MonacoTextModelService } from '@theia/monaco/lib/browser/monaco-text-model-service';
import { ChangeTracker } from '../changes/change-tracker';
import { AgentStore } from '../agents/agent-store';
import type { CodeChange, HunkState } from '../../common/changes/changes.types';
import { changeStats, isPending, reviewAnchors, reviewBase } from '../../common/changes/changes.utils';
import { reviewFileState } from '../../common/review/review';
import { fileIconClass } from '../../common/icons/file-icon-map';
import { AGENT_REVIEW_TEXT, AGENT_REVIEW_WIDGET_ID, FILE_STATE_TEXT, HUNK_ACTIONS_INSET_PX, REVEAL_MARGIN_PX, UNCHANGED_CONTEXT_LINES } from './agent-review.consts';

interface HunkRow {
    readonly widget: monaco.editor.IOverlayWidget;
    readonly node: HTMLElement;
    readonly line: number;
}

interface FileSection {
    readonly id: string;
    readonly node: HTMLElement;
    readonly head: HTMLElement;
    readonly body: HTMLElement;
    readonly host: HTMLElement;
    readonly toDispose: DisposableCollection;
    editor?: monaco.editor.IStandaloneDiffEditor;
    original?: monaco.editor.ITextModel;
    ref?: IReference<MonacoEditorModel>;
    loading?: Promise<void>;
    rows: HunkRow[];
    collapsed: boolean;
    disposed: boolean;
}

const escapeHtml = (text: string): string => text.replace(/&/g, '&amp;').replace(/</g, '&lt;').replace(/>/g, '&gt;').replace(/"/g, '&quot;');

/**
 * IDEA-268: every file the agent changed in one scrolling, side-by-side diff. The right side is the real file (editable,
 * the same model as the editor tab), the left side is the file before the pending hunks. Each hunk has Accept / Reject,
 * each file Accept file / Reject file, and the toolbar steps through changes and decides everything at once.
 */
@injectable()
export class AgentReviewWidget extends BaseWidget {

    @inject(ChangeTracker) protected readonly tracker: ChangeTracker;
    @inject(AgentStore) protected readonly store: AgentStore;
    @inject(MonacoTextModelService) protected readonly textModels: MonacoTextModelService;

    protected sessionId?: string;
    protected readonly sections = new Map<string, FileSection>();
    protected toolbarRoot: Root;
    protected list: HTMLElement;
    protected empty: HTMLElement;

    @postConstruct()
    protected init(): void {
        this.id = AGENT_REVIEW_WIDGET_ID;
        this.title.label = AGENT_REVIEW_TEXT.title;
        this.title.caption = AGENT_REVIEW_TEXT.title;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-diff-multiple';
        this.addClass('ingot-agent-review');
        const toolbar = document.createElement('div');
        toolbar.className = 'ingot-rv-toolbar';
        this.list = document.createElement('div');
        this.list.className = 'ingot-rv-list';
        this.list.id = 'ingot-rv-list';
        this.empty = document.createElement('div');
        this.empty.className = 'ingot-rv-empty';
        this.empty.textContent = AGENT_REVIEW_TEXT.empty;
        this.list.append(this.empty);
        this.node.append(toolbar, this.list);
        this.toolbarRoot = createRoot(toolbar);
        this.list.addEventListener('click', event => this.onListClick(event));
        this.toDispose.push({ dispose: () => this.toolbarRoot.unmount() });
        this.toDispose.push(this.tracker.onDidChange(() => this.refresh()));
        this.toDispose.push(this.store.onDidChange(() => this.renderToolbar()));
        this.toDispose.push({ dispose: () => this.clearSections() });
    }

    /** Shows the changes of one chat (the Review button passes its chat). */
    showSession(sessionId: string | undefined): void {
        if (sessionId !== this.sessionId) {
            this.clearSections();
            this.list.scrollTop = 0;
        }
        this.sessionId = sessionId;
        const title = this.session?.title;
        this.title.label = title ? `${AGENT_REVIEW_TEXT.title}: ${title}` : AGENT_REVIEW_TEXT.title;
        this.refresh();
    }

    protected get session(): { id: string; title: string } | undefined {
        return this.store.allSessions.find(s => s.id === this.sessionId);
    }

    /** The chat's latest run plus anything from earlier runs that still waits for a decision. */
    protected files(): CodeChange[] {
        const id = this.sessionId;
        if (!id) {
            return [];
        }
        const last = new Set(this.tracker.lastRun(id).map(c => c.id));
        return this.tracker.changes.filter(c => c.sessionId === id && c.status !== 'streaming' && (isPending(c) || last.has(c.id)));
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.refresh();
    }

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.list.focus();
    }

    protected refresh(): void {
        const files = this.files();
        const ids = new Set(files.map(f => f.id));
        for (const [id, section] of this.sections) {
            if (!ids.has(id)) {
                this.disposeSection(section);
                this.sections.delete(id);
            }
        }
        for (const change of files) {
            const section = this.sections.get(change.id) ?? this.createSection(change);
            this.sections.set(change.id, section);
            this.list.append(section.node);
            this.updateSection(section, change);
        }
        this.empty.hidden = files.length > 0;
        this.renderToolbar();
    }

    protected createSection(change: CodeChange): FileSection {
        const node = document.createElement('section');
        node.className = 'ingot-rv-file';
        node.dataset.path = change.path;
        const head = document.createElement('div');
        head.className = 'ingot-rv-head';
        const body = document.createElement('div');
        body.className = 'ingot-rv-body';
        const columns = document.createElement('div');
        columns.className = 'ingot-rv-columns';
        columns.innerHTML = `<span>${AGENT_REVIEW_TEXT.base}</span><span>${AGENT_REVIEW_TEXT.current}</span>`;
        const host = document.createElement('div');
        host.className = 'ingot-rv-editor';
        body.append(columns, host);
        node.append(head, body);
        return { id: change.id, node, head, body, host, toDispose: new DisposableCollection(), rows: [], collapsed: false, disposed: false };
    }

    protected updateSection(section: FileSection, change: CodeChange): void {
        const pending = isPending(change);
        const stats = changeStats(change.hunks.filter(h => pending ? h.state === 'pending' : h.state !== 'rejected'));
        const state = pending ? 'pending' : reviewFileState(change.status);
        const slash = change.path.lastIndexOf('/');
        const name = change.path.slice(slash + 1);
        const dir = slash > 0 ? change.path.slice(0, slash) : '';
        section.node.dataset.state = state;
        section.head.innerHTML = `
            <button type="button" class="ingot-rv-toggle codicon codicon-chevron-${section.collapsed || !pending ? 'right' : 'down'}" data-action="toggle" data-id="${change.id}" aria-label="Collapse"${pending ? '' : ' disabled'}></button>
            <span class="${fileIconClass(name)}"></span>
            <button type="button" class="ingot-rv-name" data-action="open" data-id="${change.id}" title="${AGENT_REVIEW_TEXT.openFile}">${escapeHtml(name)}</button>
            <span class="ingot-rv-dir">${escapeHtml(dir)}</span>
            <span class="ingot-rv-stats"><span class="ingot-plus">+${stats.added}</span> <span class="ingot-minus">−${stats.removed}</span></span>
            <span class="ingot-rv-state ${state}">${FILE_STATE_TEXT[state]}</span>
            <span class="ingot-flex"></span>
            ${pending ? `<button type="button" class="ingot-review-link ingot-rv-reject-file" data-action="reject-file" data-id="${change.id}">${AGENT_REVIEW_TEXT.rejectFile}</button>
            <button type="button" class="ingot-review-link accept ingot-rv-accept-file" data-action="accept-file" data-id="${change.id}">${AGENT_REVIEW_TEXT.acceptFile}</button>` : ''}`;
        section.body.hidden = !pending || section.collapsed;
        if (!pending || !this.isAttached) {
            return;
        }
        void this.ensureEditor(section, change).then(() => {
            const latest = this.tracker.find(change.id);
            if (latest && !section.disposed) {
                this.syncSection(section, latest);
            }
        });
    }

    protected ensureEditor(section: FileSection, change: CodeChange): Promise<void> {
        section.loading ??= (async () => {
            const ref = await this.textModels.createModelReference(new URI(change.uri));
            if (section.disposed) {
                ref.dispose();
                return;
            }
            section.ref = ref;
            section.toDispose.push(ref);
            const modified = ref.object.textEditorModel;
            const original = monaco.editor.createModel(reviewBase(change), modified.getLanguageId());
            section.original = original;
            section.toDispose.push(original);
            const editor = monaco.editor.createDiffEditor(section.host, {
                automaticLayout: true,
                renderSideBySide: true,
                useInlineViewWhenSpaceIsLimited: false,
                originalEditable: false,
                readOnly: false,
                renderMarginRevertIcon: false,
                ignoreTrimWhitespace: false,
                renderOverviewRuler: false,
                scrollBeyondLastLine: false,
                minimap: { enabled: false },
                hideUnchangedRegions: { enabled: true, contextLineCount: UNCHANGED_CONTEXT_LINES },
                // The list scrolls, not each file: wheel events pass through to it.
                scrollbar: { vertical: 'hidden', alwaysConsumeMouseWheel: false, verticalScrollbarSize: 0 }
            });
            section.editor = editor;
            section.toDispose.push(editor);
            editor.setModel({ original, modified });
            const fit = (): void => this.fitSection(section);
            section.toDispose.push(editor.getOriginalEditor().onDidContentSizeChange(fit));
            section.toDispose.push(editor.getModifiedEditor().onDidContentSizeChange(fit));
            section.toDispose.push(editor.getModifiedEditor().onDidLayoutChange(() => this.placeRows(section)));
            section.toDispose.push(editor.getModifiedEditor().onDidScrollChange(() => this.placeRows(section)));
            section.toDispose.push(editor.onDidUpdateDiff(() => { fit(); this.placeRows(section); }));
            fit();
        })();
        return section.loading;
    }

    protected fitSection(section: FileSection): void {
        const editor = section.editor;
        if (!editor) {
            return;
        }
        const height = Math.max(editor.getOriginalEditor().getContentHeight(), editor.getModifiedEditor().getContentHeight());
        if (section.host.style.height !== `${height}px`) {
            section.host.style.height = `${height}px`;
            editor.layout();
        }
        this.placeRows(section);
    }

    /** Keeps the left side on the reviewed base and redraws the per-hunk Accept / Reject rows. */
    protected syncSection(section: FileSection, change: CodeChange): void {
        const original = section.original;
        const modified = section.editor?.getModifiedEditor();
        if (!original || !modified) {
            return;
        }
        const base = reviewBase(change);
        if (original.getValue() !== base) {
            original.setValue(base);
        }
        section.rows.forEach(row => modified.removeOverlayWidget(row.widget));
        section.rows = reviewAnchors(change.hunks, modified.getModel()?.getLineCount() ?? 1).map(anchor => {
            const node = document.createElement('div');
            node.className = 'ingot-rv-hunk-actions';
            node.dataset.hunk = anchor.hunkId;
            node.addEventListener('mousedown', event => event.stopPropagation());
            const button = (label: string, state: HunkState): HTMLButtonElement => {
                const el = document.createElement('button');
                el.type = 'button';
                el.id = `ingot-rv-${state === 'accepted' ? 'accept' : 'reject'}-${anchor.hunkId}`;
                el.className = state === 'accepted' ? 'ingot-rv-hunk-accept' : 'ingot-rv-hunk-reject';
                el.textContent = label;
                el.addEventListener('click', event => {
                    event.preventDefault();
                    event.stopPropagation();
                    void this.tracker.decide(change.id, [anchor.hunkId], state);
                });
                return el;
            };
            const counts = document.createElement('span');
            counts.className = 'ingot-rv-hunk-counts';
            counts.innerHTML = `<span class="ingot-plus">+${anchor.added}</span> <span class="ingot-minus">−${anchor.removed}</span>`;
            node.append(counts, button(AGENT_REVIEW_TEXT.reject, 'rejected'), button(AGENT_REVIEW_TEXT.accept, 'accepted'));
            const widget: monaco.editor.IOverlayWidget = { getId: () => `ingot.review.${change.id}.${anchor.hunkId}`, getDomNode: () => node, getPosition: () => null };
            modified.addOverlayWidget(widget);
            return { widget, node, line: anchor.line };
        });
        this.placeRows(section);
    }

    protected placeRows(section: FileSection): void {
        const modified = section.editor?.getModifiedEditor();
        if (!modified) {
            return;
        }
        const scrollTop = modified.getScrollTop();
        for (const row of section.rows) {
            row.node.style.top = `${modified.getTopForLineNumber(row.line) - scrollTop}px`;
            row.node.style.right = `${HUNK_ACTIONS_INSET_PX}px`;
        }
    }

    protected onListClick(event: MouseEvent): void {
        const target = (event.target as HTMLElement).closest<HTMLElement>('[data-action]');
        const id = target?.dataset.id;
        if (!target || !id) {
            return;
        }
        switch (target.dataset.action) {
            case 'accept-file': void this.tracker.decide(id, 'all', 'accepted'); break;
            case 'reject-file': void this.tracker.decide(id, 'all', 'rejected'); break;
            case 'open': void this.tracker.reveal(id, undefined, true); break;
            case 'toggle': {
                const section = this.sections.get(id);
                const change = this.tracker.find(id);
                if (section && change) {
                    section.collapsed = !section.collapsed;
                    this.updateSection(section, change);
                }
                break;
            }
        }
    }

    /** Scrolls the list to the next (1) or previous (-1) hunk that waits for a decision. */
    step(direction: 1 | -1): void {
        const listTop = this.list.getBoundingClientRect().top;
        const stops = [...this.sections.values()].filter(s => !s.body.hidden && s.editor).flatMap(section => section.rows.map(row =>
            section.body.getBoundingClientRect().top - listTop + this.list.scrollTop + section.editor!.getModifiedEditor().getTopForLineNumber(row.line)));
        const at = this.list.scrollTop + REVEAL_MARGIN_PX;
        const next = direction > 0 ? stops.find(top => top > at + 1) : [...stops].reverse().find(top => top < at - 1);
        if (next !== undefined) {
            this.list.scrollTo({ top: Math.max(0, next - REVEAL_MARGIN_PX) });
        }
    }

    protected decideAll(state: HunkState): void {
        if (this.sessionId) {
            void this.tracker.decideAll(state, this.sessionId);
        }
    }

    protected renderToolbar(): void {
        const files = this.files();
        const pending = files.filter(isPending);
        const hunks = pending.flatMap(c => c.hunks.filter(h => h.state === 'pending'));
        const stats = changeStats(hunks);
        const fileWord = files.length === 1 ? 'file' : 'files';
        this.toolbarRoot.render(<div className='ingot-rv-bar' role='toolbar' aria-label={AGENT_REVIEW_TEXT.title}>
            <span className='codicon codicon-diff-multiple' />
            <span className='ingot-rv-title'>{this.session?.title ?? AGENT_REVIEW_TEXT.title}</span>
            <span className='ingot-rv-totals' id='ingot-rv-totals'>
                {files.length} {fileWord} · <span className='ingot-plus'>+{stats.added}</span> <span className='ingot-minus'>−{stats.removed}</span> · {hunks.length} pending
            </span>
            <span className='ingot-flex' />
            <button type='button' id='ingot-rv-prev' className='ingot-lc-tool' title={AGENT_REVIEW_TEXT.prev} aria-label={AGENT_REVIEW_TEXT.prev} disabled={!hunks.length} onClick={() => this.step(-1)}>
                <span className='codicon codicon-arrow-up' />
            </button>
            <button type='button' id='ingot-rv-next' className='ingot-lc-tool' title={AGENT_REVIEW_TEXT.next} aria-label={AGENT_REVIEW_TEXT.next} disabled={!hunks.length} onClick={() => this.step(1)}>
                <span className='codicon codicon-arrow-down' />
            </button>
            <button type='button' id='ingot-rv-reject-all' className='ingot-review-link' disabled={!hunks.length} onClick={() => this.decideAll('rejected')}>{AGENT_REVIEW_TEXT.rejectAll}</button>
            <button type='button' id='ingot-rv-accept-all' className='ingot-btn-primary ingot-review-accept' disabled={!hunks.length} onClick={() => this.decideAll('accepted')}>{AGENT_REVIEW_TEXT.acceptAll}</button>
        </div>);
    }

    protected disposeSection(section: FileSection): void {
        section.disposed = true;
        section.toDispose.dispose();
        section.node.remove();
    }

    protected clearSections(): void {
        this.sections.forEach(section => this.disposeSection(section));
        this.sections.clear();
    }
}
