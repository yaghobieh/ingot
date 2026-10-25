import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import type { EditorWidget } from '@theia/editor/lib/browser/editor-widget';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import * as monaco from '@theia/monaco-editor-core';
import { AgentStore } from '../agents/agent-store';
import { ChangeTracker } from '../changes/change-tracker';
import { excerptAt, formatReviewComments, resolvedIds, type ReviewComment } from '../../common/review/review';

interface Box {
    readonly zoneId: string;
    readonly overlay: monaco.editor.IOverlayWidget;
    readonly place: () => void;
}

interface Attached {
    readonly control: monaco.editor.ICodeEditor;
    readonly listeners: { dispose(): void }[];
    hover?: monaco.editor.IEditorDecorationsCollection;
    boxes: Box[];
}

/**
 * IDEA-105 GitLab-style review comments on agent-changed files: hover a line for a + in the gutter, write a comment
 * under that line, collect drafts across files, then "Finish review" sends them to the agent as one message.
 * The agent's reply marks comments resolved (`[resolved: id]`, or a new edit to that file); they can be resolved by hand.
 */
@injectable()
export class ReviewComments {

    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(ChangeTracker) protected readonly tracker: ChangeTracker;
    @inject(AgentStore) protected readonly store: AgentStore;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;

    protected list: ReviewComment[] = [];
    protected readonly attached = new Map<EditorWidget, Attached>();
    /** The open "new comment" box: file + line. */
    protected composing?: { uri: string; line: number };
    protected counter = 0;
    /** Per submitted batch: the chat and the agent message count when it was sent. */
    protected readonly submissions = new Map<string, { sessionId: string; after: number; ids: string[] }>();

    @postConstruct()
    protected init(): void {
        this.editors.onCreated(widget => this.attach(widget));
        this.editors.all.forEach(widget => this.attach(widget));
        this.tracker.onDidChange(() => this.redrawAll());
        this.store.onDidChange(() => {
            this.checkResolved();
            this.redrawAll();
        });
    }

    get comments(): readonly ReviewComment[] {
        return this.list;
    }

    drafts(sessionId?: string): ReviewComment[] {
        return this.list.filter(c => c.state === 'draft' && (!sessionId || c.sessionId === sessionId));
    }

    protected get enabled(): boolean {
        return this.store.review.inlineComments;
    }

    /** The chat whose agent changed this file (latest), if any. */
    protected sessionFor(uri: string): { sessionId: string; path: string } | undefined {
        const change = [...this.tracker.changes].reverse().find(c => c.uri === uri);
        return change && { sessionId: change.sessionId, path: change.path };
    }

    startComment(uri: string, line: number): void {
        this.composing = { uri, line };
        this.store.holdPause(this.sessionFor(uri)?.sessionId ?? '');
        this.redrawAll();
    }

    add(uri: string, line: number, text: string, fileText: string): ReviewComment | undefined {
        const owner = this.sessionFor(uri);
        if (!owner || !text.trim()) {
            return undefined;
        }
        const comment: ReviewComment = {
            id: `c${++this.counter}`, sessionId: owner.sessionId, path: owner.path, uri, line,
            excerpt: excerptAt(fileText, line), text: text.trim(), state: 'draft'
        };
        this.list = [...this.list, comment];
        this.composing = undefined;
        this.fire();
        return comment;
    }

    remove(id: string): void {
        this.list = this.list.filter(c => c.id !== id);
        this.fire();
    }

    resolve(id: string): void {
        this.list = this.list.map(c => (c.id === id ? { ...c, state: 'resolved' } : c));
        this.fire();
    }

    /** "Finish review": every draft of the chat goes to the agent as one structured message. */
    submit(sessionId: string): boolean {
        const drafts = this.drafts(sessionId);
        if (!drafts.length) {
            return false;
        }
        const session = this.store.sessions.find(s => s.id === sessionId);
        const after = session ? session.messages.filter(m => m.role === 'agent').length : 0;
        this.submissions.set(`${sessionId}:${after}`, { sessionId, after, ids: drafts.map(d => d.id) });
        this.list = this.list.map(c => (drafts.some(d => d.id === c.id) ? { ...c, state: 'submitted' } : c));
        this.store.select(sessionId);
        this.store.send(formatReviewComments(drafts));
        this.fire();
        return true;
    }

    /** Agent replies after a submission resolve the comments they mention, or that touch the same file. */
    protected checkResolved(): void {
        let changed = false;
        for (const [key, sub] of this.submissions) {
            const session = this.store.sessions.find(s => s.id === sub.sessionId);
            // Only a finished reply counts (the run's first update has an empty, still-streaming message).
            if (!session || this.store.isRunning(session.id) || session.status === 'thinking' || session.status === 'editing') {
                continue;
            }
            const replies = session.messages.map((m, i) => ({ m, i })).filter(x => x.m.role === 'agent').slice(sub.after);
            if (!replies.length || replies.some(r => r.m.expanded === undefined)) {
                continue;
            }
            const named = new Set(replies.flatMap(r => resolvedIds(r.m.expanded ?? r.m.text)));
            const edited = new Set(replies.flatMap(r => this.tracker.forMessage(session.id, r.i).map(c => c.uri)));
            this.list = this.list.map(c => {
                if (sub.ids.includes(c.id) && c.state === 'submitted' && (named.has(c.id) || edited.has(c.uri))) {
                    changed = true;
                    return { ...c, state: 'resolved' };
                }
                return c;
            });
            this.submissions.delete(key);
        }
        if (changed) {
            this.fire();
        }
    }

    protected fire(): void {
        this.redrawAll();
        this.onDidChangeEmitter.fire();
    }

    protected attach(widget: EditorWidget): void {
        if (this.attached.has(widget) || !(widget.editor instanceof MonacoEditor)) {
            return;
        }
        const control = widget.editor.getControl();
        const entry: Attached = { control, listeners: [], boxes: [] };
        const uri = widget.editor.uri.toString();
        entry.listeners.push(control.onMouseMove(e => {
            const line = e.target.position?.lineNumber;
            if (!this.enabled || !line || !this.sessionFor(uri)) {
                entry.hover?.clear();
                return;
            }
            const decoration = [{ range: new monaco.Range(line, 1, line, 1), options: { glyphMarginClassName: 'ingot-review-plus codicon codicon-add', glyphMarginHoverMessage: { value: 'Add a review comment' } } }];
            if (entry.hover) {
                entry.hover.set(decoration);
            } else {
                entry.hover = control.createDecorationsCollection(decoration);
            }
        }));
        entry.listeners.push(control.onMouseLeave(() => entry.hover?.clear()));
        entry.listeners.push(control.onMouseDown(e => {
            const element = e.target.element;
            const line = e.target.position?.lineNumber;
            if (line && element?.classList.contains('ingot-review-plus')) {
                this.startComment(uri, line);
            }
        }));
        entry.listeners.push(control.onDidLayoutChange(() => entry.boxes.forEach(b => b.place())));
        entry.listeners.push(control.onDidScrollChange(() => entry.boxes.forEach(b => b.place())));
        this.attached.set(widget, entry);
        widget.disposed.connect(() => {
            entry.listeners.forEach(l => l.dispose());
            this.attached.delete(widget);
        });
        this.redraw(widget, entry);
    }

    protected redrawAll(): void {
        this.attached.forEach((entry, widget) => this.redraw(widget, entry));
    }

    /** Comment boxes are a view zone (space) plus an overlay widget (clickable, Monaco's text layer would swallow it). */
    protected redraw(widget: EditorWidget, entry: Attached): void {
        const { control } = entry;
        const uri = widget.editor.uri.toString();
        control.changeViewZones(accessor => entry.boxes.forEach(b => accessor.removeZone(b.zoneId)));
        entry.boxes.forEach(b => control.removeOverlayWidget(b.overlay));
        entry.boxes = [];
        const active = this.enabled && !!this.sessionFor(uri);
        control.updateOptions({ glyphMargin: active || control.getOption(monaco.editor.EditorOption.glyphMargin) });
        if (!active) {
            return;
        }
        const nodes: { line: number; node: HTMLElement; id: string }[] = this.list
            .filter(c => c.uri === uri && c.state !== 'resolved')
            .map(c => ({ line: c.line, node: this.commentNode(c), id: c.id }));
        if (this.composing?.uri === uri) {
            nodes.push({ line: this.composing.line, node: this.composeNode(uri, this.composing.line, control), id: 'new' });
        }
        for (const { line, node, id } of nodes) {
            const height = id === 'new' ? 112 : 64;
            node.style.height = `${height - 8}px`;
            let zoneId = '';
            control.changeViewZones(accessor => { zoneId = accessor.addZone({ afterLineNumber: line, heightInPx: height, domNode: document.createElement('div'), suppressMouseDown: true }); });
            const overlay: monaco.editor.IOverlayWidget = { getId: () => `ingot.review.${uri}.${id}`, getDomNode: () => node, getPosition: () => null };
            control.addOverlayWidget(overlay);
            const place = (): void => {
                const layout = control.getLayoutInfo();
                const top = control.getTopForLineNumber(line + 1) - height - control.getScrollTop() + 4;
                node.style.display = top > -height && top < layout.height ? '' : 'none';
                node.style.top = `${top}px`;
                node.style.left = `${layout.contentLeft + 8}px`;
                node.style.width = `${Math.max(240, layout.contentWidth - 40)}px`;
            };
            entry.boxes.push({ zoneId, overlay, place });
            place();
            requestAnimationFrame(place);
        }
    }

    protected button(label: string, cls: string, onClick: () => void): HTMLButtonElement {
        const b = document.createElement('button');
        b.type = 'button';
        b.className = cls;
        b.textContent = label;
        b.addEventListener('mousedown', e => e.stopPropagation());
        b.addEventListener('click', e => { e.stopPropagation(); onClick(); });
        return b;
    }

    protected commentNode(comment: ReviewComment): HTMLElement {
        const node = document.createElement('div');
        node.className = `ingot-review-comment ${comment.state}`;
        node.dataset.commentId = comment.id;
        node.dataset.line = String(comment.line);
        const text = document.createElement('div');
        text.className = 'ingot-review-comment-text';
        text.textContent = comment.text;
        const meta = document.createElement('div');
        meta.className = 'ingot-review-comment-meta';
        const badge = document.createElement('span');
        badge.className = 'ingot-review-comment-state';
        badge.textContent = comment.state === 'draft' ? 'Pending' : 'Sent to agent';
        meta.append(badge,
            this.button('Resolve', 'ingot-btn-ghost ingot-review-comment-resolve', () => this.resolve(comment.id)),
            ...(comment.state === 'draft' ? [this.button('Delete', 'ingot-btn-ghost ingot-review-comment-delete', () => this.remove(comment.id))] : []));
        node.append(text, meta);
        return node;
    }

    /** The open box is reused across redraws so typed text and focus survive (chat updates redraw often). */
    protected composeCache?: { key: string; node: HTMLElement };

    protected composeNode(uri: string, line: number, control: monaco.editor.ICodeEditor): HTMLElement {
        const key = `${uri}:${line}`;
        if (this.composeCache?.key === key) {
            return this.composeCache.node;
        }
        const node = document.createElement('div');
        node.className = 'ingot-review-compose';
        node.id = 'ingot-review-compose';
        const area = document.createElement('textarea');
        area.className = 'ingot-review-compose-input';
        area.placeholder = `Comment on line ${line}… (⌘⏎ to add)`;
        area.addEventListener('keydown', e => {
            e.stopPropagation();
            if (e.key === 'Enter' && (e.metaKey || e.ctrlKey)) {
                e.preventDefault();
                this.add(uri, line, area.value, control.getModel()?.getValue() ?? '');
            } else if (e.key === 'Escape') {
                this.composing = undefined;
                this.redrawAll();
            }
        });
        area.addEventListener('mousedown', e => e.stopPropagation());
        const row = document.createElement('div');
        row.className = 'ingot-review-compose-actions';
        row.append(
            this.button('Cancel', 'ingot-btn-ghost ingot-review-compose-cancel', () => { this.composing = undefined; this.redrawAll(); }),
            this.button('Add comment', 'ingot-btn-primary ingot-review-compose-add', () => this.add(uri, line, area.value, control.getModel()?.getValue() ?? ''))
        );
        node.append(area, row);
        setTimeout(() => area.focus());
        this.composeCache = { key, node };
        return node;
    }
}
