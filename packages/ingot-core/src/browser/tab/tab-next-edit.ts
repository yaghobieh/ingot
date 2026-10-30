import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import * as monaco from '@theia/monaco-editor-core';
import { ContextKeyService, type ContextKey } from '@theia/core/lib/browser/context-key-service';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { findNextEditLine } from '../../common/tab/tab.utils';
import {
    INLINE_SUGGEST_TRIGGER, TAB_HINT_CLASS, TAB_NEXT_EDIT_KEY, TAB_TARGET_HINT, TAB_TARGET_LINE_CLASS, TAB_TRIGGER_SOURCE, tabCursorHint
} from './tab.consts';

interface NextEditTarget {
    readonly editor: monaco.editor.ICodeEditor;
    readonly line: number;
    readonly column: number;
}

/**
 * Next-edit jump hint: marks the line the model expects the user to change next. Tab jumps there and asks
 * for a new prediction, Esc or any edit dismisses it.
 */
@injectable()
export class IngotTabNextEdit {

    @inject(ContextKeyService) protected readonly contextKeys: ContextKeyService;
    @inject(EditorManager) protected readonly editors: EditorManager;

    protected visibleKey: ContextKey<boolean>;
    protected target?: NextEditTarget;
    protected decorations?: monaco.editor.IEditorDecorationsCollection;
    protected listeners: monaco.IDisposable[] = [];

    @postConstruct()
    protected init(): void {
        this.visibleKey = this.contextKeys.createKey<boolean>(TAB_NEXT_EDIT_KEY, false);
    }

    get visible(): boolean {
        return !!this.target;
    }

    /** Shows the hint on the line containing `snippet` in the focused editor for `uri`. */
    show(uri: string, snippet: string): boolean {
        const editor = this.focusedEditor(uri);
        const model = editor?.getModel();
        const cursor = editor?.getPosition();
        if (!editor || !model || !cursor) {
            return false;
        }
        const line = findNextEditLine(model.getLinesContent(), snippet, cursor.lineNumber);
        if (!line) {
            return false;
        }
        this.dismiss();
        const column = Math.max(model.getLineContent(line).indexOf(snippet.trim()), 0) + 1;
        this.target = { editor, line, column };
        const end = (n: number): monaco.Range => new monaco.Range(n, model.getLineMaxColumn(n), n, model.getLineMaxColumn(n));
        this.decorations = editor.createDecorationsCollection([
            { range: new monaco.Range(line, 1, line, 1), options: { isWholeLine: true, className: TAB_TARGET_LINE_CLASS } },
            { range: end(line), options: { showIfCollapsed: true, after: { content: TAB_TARGET_HINT, inlineClassName: TAB_HINT_CLASS } } },
            ...(cursor.lineNumber === line ? [] : [{
                range: end(cursor.lineNumber), options: { showIfCollapsed: true, after: { content: tabCursorHint(line), inlineClassName: TAB_HINT_CLASS } }
            }])
        ]);
        this.listeners.push(editor.onDidChangeModelContent(() => this.dismiss()), editor.onDidChangeModel(() => this.dismiss()));
        this.visibleKey.set(true);
        return true;
    }

    /** Moves the cursor to the hinted line and asks Tab for the edit there. */
    jump(): boolean {
        const target = this.target;
        if (!target) {
            return false;
        }
        this.dismiss();
        target.editor.setPosition({ lineNumber: target.line, column: target.column });
        target.editor.revealLineInCenterIfOutsideViewport(target.line);
        target.editor.focus();
        target.editor.trigger(TAB_TRIGGER_SOURCE, INLINE_SUGGEST_TRIGGER, {});
        return true;
    }

    dismiss(): void {
        this.decorations?.clear();
        this.decorations = undefined;
        this.target = undefined;
        this.listeners.forEach(l => l.dispose());
        this.listeners = [];
        this.visibleKey.set(false);
    }

    protected focusedEditor(uri: string): monaco.editor.ICodeEditor | undefined {
        const widget = this.editors.currentEditor;
        const control = widget ? MonacoEditor.get(widget)?.getControl() : undefined;
        return control?.getModel()?.uri.toString() === uri ? control : undefined;
    }
}
