import * as monaco from '@theia/monaco-editor-core';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { INLINE_EDIT_TEXT } from '../../common/inline-edit/inline-edit.consts';
import type { LineSpan } from '../../common/inline-edit/inline-edit.types';
import {
    INLINE_EDIT_DOM_ID, INLINE_EDIT_GAP_PX, INLINE_EDIT_HEIGHT_PX, INLINE_EDIT_INPUT_ID, INLINE_EDIT_MAX_WIDTH_PX, INLINE_EDIT_RIGHT_INSET_PX, INLINE_EDIT_WIDGET_ID
} from './inline-edit.browser-consts';

export interface InlineEditHandlers {
    submit(instruction: string): void;
    cancel(): void;
}

/**
 * The Cmd+K prompt (IDEA-262): a content widget in a gap above the selected lines, which stay highlighted.
 * Keys typed in the prompt never reach the editor or the workbench keymap (Enter generates, Esc closes).
 */
export class InlineEditWidget implements monaco.editor.IContentWidget {

    readonly allowEditorOverflow = false;
    readonly suppressMouseDown = true;
    protected readonly node: HTMLElement;
    protected readonly input: HTMLInputElement;
    protected readonly status: HTMLElement;
    protected readonly submitButton: HTMLButtonElement;
    protected readonly toDispose = new DisposableCollection();
    protected busy = false;

    constructor(protected readonly control: monaco.editor.ICodeEditor, readonly span: LineSpan, protected readonly handlers: InlineEditHandlers) {
        this.node = document.createElement('div');
        this.node.id = INLINE_EDIT_DOM_ID;
        this.node.className = 'ingot-inline-edit';
        this.node.style.height = `${INLINE_EDIT_HEIGHT_PX}px`;
        const icon = document.createElement('span');
        icon.className = 'ingot-inline-edit-icon codicon codicon-sparkle';
        this.input = document.createElement('input');
        this.input.id = INLINE_EDIT_INPUT_ID;
        this.input.type = 'text';
        this.input.className = 'ingot-inline-edit-input';
        this.input.placeholder = INLINE_EDIT_TEXT.placeholder;
        this.input.setAttribute('aria-label', INLINE_EDIT_TEXT.placeholder);
        this.input.spellcheck = false;
        this.status = document.createElement('span');
        this.status.className = 'ingot-inline-edit-status';
        this.status.setAttribute('role', 'status');
        this.submitButton = this.button('ingot-inline-edit-submit', 'arrow-up', 'Generate (Enter)', () => this.submit());
        const close = this.button('ingot-inline-edit-close', 'close', 'Close (Esc)', () => this.handlers.cancel());
        // Monaco sets `display` on the widget node itself, so the controls are laid out in a row inside it.
        const row = document.createElement('div');
        row.className = 'ingot-inline-edit-row';
        row.append(icon, this.input, this.status, this.submitButton, close);
        this.node.append(row);

        const onKey = (event: KeyboardEvent): void => this.onKey(event);
        window.addEventListener('keydown', onKey, true);
        this.toDispose.push({ dispose: () => window.removeEventListener('keydown', onKey, true) });

        let zoneId = '';
        control.changeViewZones(accessor => {
            zoneId = accessor.addZone({ afterLineNumber: span.startLine - 1, heightInPx: INLINE_EDIT_HEIGHT_PX + INLINE_EDIT_GAP_PX, domNode: document.createElement('div') });
        });
        this.toDispose.push({ dispose: () => control.changeViewZones(accessor => accessor.removeZone(zoneId)) });
        control.addContentWidget(this);
        this.toDispose.push({ dispose: () => control.removeContentWidget(this) });
        const range = control.createDecorationsCollection([{
            range: new monaco.Range(span.startLine, 1, span.endLine, 1),
            options: { isWholeLine: true, className: 'ingot-inline-edit-range' }
        }]);
        this.toDispose.push({ dispose: () => range.clear() });
        this.toDispose.push(control.onDidLayoutChange(() => this.layout()));
        this.layout();
        control.revealLinesInCenterIfOutsideViewport(span.startLine, span.endLine);
        requestAnimationFrame(() => this.input.focus());
    }

    getId(): string {
        return INLINE_EDIT_WIDGET_ID;
    }

    getDomNode(): HTMLElement {
        return this.node;
    }

    getPosition(): monaco.editor.IContentWidgetPosition {
        return { position: { lineNumber: this.span.startLine, column: 1 }, preference: [monaco.editor.ContentWidgetPositionPreference.ABOVE] };
    }

    setBusy(text: string): void {
        this.busy = true;
        this.node.classList.add('busy');
        this.node.classList.remove('error');
        this.input.readOnly = true;
        this.submitButton.disabled = true;
        this.status.innerHTML = `<span class="codicon codicon-loading codicon-modifier-spin"></span>`;
        this.status.append(document.createTextNode(text));
    }

    setError(text: string): void {
        this.busy = false;
        this.node.classList.remove('busy');
        this.node.classList.add('error');
        this.input.readOnly = false;
        this.submitButton.disabled = false;
        this.status.textContent = text;
        this.status.title = text;
        this.input.focus();
    }

    dispose(): void {
        this.toDispose.dispose();
    }

    protected layout(): void {
        const layout = this.control.getLayoutInfo();
        this.node.style.width = `${Math.max(0, Math.min(INLINE_EDIT_MAX_WIDTH_PX, layout.contentWidth - INLINE_EDIT_RIGHT_INSET_PX))}px`;
    }

    protected submit(): void {
        const instruction = this.input.value.trim();
        if (instruction && !this.busy) {
            this.handlers.submit(instruction);
        }
    }

    protected onKey(event: KeyboardEvent): void {
        if (!(event.target instanceof Node) || !this.node.contains(event.target)) {
            return;
        }
        event.stopPropagation();
        if (event.key === 'Escape') {
            event.preventDefault();
            this.handlers.cancel();
        } else if (event.key === 'Enter' && !event.shiftKey && !event.isComposing) {
            event.preventDefault();
            this.submit();
        }
    }

    protected button(id: string, codicon: string, title: string, run: () => void): HTMLButtonElement {
        const button = document.createElement('button');
        button.type = 'button';
        button.id = id;
        button.className = `ingot-inline-edit-button codicon codicon-${codicon}`;
        button.title = title;
        button.setAttribute('aria-label', title);
        button.addEventListener('click', event => {
            event.preventDefault();
            run();
        });
        return button;
    }
}
