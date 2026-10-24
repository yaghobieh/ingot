import { inject, injectable } from '@theia/core/shared/inversify';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import { ContextKeyService, type ContextKey } from '@theia/core/lib/browser/context-key-service';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import type { EditorWidget } from '@theia/editor/lib/browser/editor-widget';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import * as monaco from '@theia/monaco-editor-core';
import URI from '@theia/core/lib/common/uri';
import { diffStats, lineDiff } from '../../common/diff/diff.utils';
import type { DiffStats } from '../../common/diff/diff.types';

export const AGENT_EDIT_PENDING_KEY = 'ingotAgentEditPending';

export interface PendingEdit {
    readonly uri: string;
    readonly label: string;
    readonly stats: DiffStats;
}

interface ActiveReview extends PendingEdit {
    readonly oldText: string;
    readonly control: monaco.editor.ICodeEditor;
    readonly widget: EditorWidget;
    readonly decorations: monaco.editor.IEditorDecorationsCollection;
    readonly zoneIds: string[];
    readonly bar: HTMLElement;
}

/** Inline red/green review of an agent's edit with a floating Accept / Reject bar (IDEA-29). */
@injectable()
export class AgentEditReview {

    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(ContextKeyService) protected readonly contextKeys: ContextKeyService;

    protected readonly onDidChangeEmitter = new Emitter<PendingEdit | undefined>();
    readonly onDidChange: Event<PendingEdit | undefined> = this.onDidChangeEmitter.event;
    protected active?: ActiveReview;
    protected pendingKey?: ContextKey<boolean>;

    get pending(): PendingEdit | undefined {
        return this.active;
    }

    /** Applies `newText` to the file and shows the change for review. */
    async propose(uri: URI, newText: string): Promise<PendingEdit | undefined> {
        this.clear();
        const widget = await this.editors.open(uri, { mode: 'activate' });
        const editor = widget.editor;
        if (!(editor instanceof MonacoEditor)) {
            return undefined;
        }
        const control = editor.getControl();
        const model = control.getModel();
        if (!model) {
            return undefined;
        }
        const oldText = model.getValue();
        const hunks = lineDiff(oldText, newText);
        control.executeEdits('ingot-agent', [{ range: model.getFullModelRange(), text: newText }]);

        const decorations = control.createDecorationsCollection(hunks.flatMap(h => h.added.map((_, i) => ({
            range: new monaco.Range(h.newStart + i + 1, 1, h.newStart + i + 1, 1),
            options: { isWholeLine: true, className: 'ingot-diff-added-line', linesDecorationsClassName: 'ingot-diff-added-gutter' }
        }))));
        const zoneIds: string[] = [];
        control.changeViewZones(accessor => {
            for (const hunk of hunks.filter(h => h.removed.length)) {
                const node = document.createElement('div');
                node.className = 'ingot-diff-removed-zone';
                for (const line of hunk.removed) {
                    const row = document.createElement('div');
                    row.className = 'ingot-diff-removed-line';
                    row.textContent = line || ' ';
                    node.appendChild(row);
                }
                zoneIds.push(accessor.addZone({ afterLineNumber: hunk.newStart, heightInLines: hunk.removed.length, domNode: node }));
            }
        });
        const label = uri.path.base;
        const stats = diffStats(hunks);
        const bar = this.createBar(label, stats);
        widget.node.appendChild(bar);
        this.active = { uri: uri.toString(), label, stats, oldText, control, widget, decorations, zoneIds, bar };
        this.setPending(true);
        this.onDidChangeEmitter.fire(this.active);
        return this.active;
    }

    accept(): void {
        this.clear();
    }

    reject(): void {
        const review = this.active;
        if (review) {
            const model = review.control.getModel();
            if (model) {
                review.control.executeEdits('ingot-agent', [{ range: model.getFullModelRange(), text: review.oldText }]);
            }
        }
        this.clear();
    }

    protected clear(): void {
        const review = this.active;
        if (!review) {
            return;
        }
        review.decorations.clear();
        review.control.changeViewZones(accessor => review.zoneIds.forEach(id => accessor.removeZone(id)));
        review.bar.remove();
        this.active = undefined;
        this.setPending(false);
        this.onDidChangeEmitter.fire(undefined);
    }

    protected setPending(value: boolean): void {
        this.pendingKey ??= this.contextKeys.createKey<boolean>(AGENT_EDIT_PENDING_KEY, false);
        this.pendingKey.set(value);
    }

    protected createBar(label: string, stats: DiffStats): HTMLElement {
        const bar = document.createElement('div');
        bar.className = 'ingot-agent-edit-bar';
        bar.innerHTML = `
            <span class="ingot-agent-dot"></span>
            <span class="ingot-agent-edit-text">Agent edit · <span class="ingot-plus">+${stats.added}</span> <span class="ingot-minus">−${stats.removed}</span> in <span class="ingot-agent-edit-file"></span></span>
            <span class="ingot-agent-edit-spacer"></span>
            <button type="button" class="ingot-agent-edit-reject">Reject <kbd>Ctrl+N</kbd></button>
            <button type="button" class="ingot-agent-edit-accept">Accept <kbd>Ctrl+Y</kbd></button>`;
        (bar.querySelector('.ingot-agent-edit-file') as HTMLElement).textContent = label;
        bar.querySelector('.ingot-agent-edit-reject')?.addEventListener('click', () => this.reject());
        bar.querySelector('.ingot-agent-edit-accept')?.addEventListener('click', () => this.accept());
        return bar;
    }
}
