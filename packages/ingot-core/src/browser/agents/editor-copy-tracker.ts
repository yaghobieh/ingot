import { inject, injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { CommandRegistry } from '@theia/core/lib/common/command';
import URI from '@theia/core/lib/common/uri';
import { EditorManager } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { WorkspaceService } from '@theia/workspace/lib/browser';
import { EDITOR_COPY_COMMANDS, INGOT_REF_MIME, lineCount, parseIngotRef, sameClipboardText, type ContextChip } from '../../common/agents/context-chips';

export type EditorCopy = Omit<ContextChip, 'id'> & { readonly at: number };

/**
 * Remembers the last copy/cut made in a code editor (IDEA-65), so pasting that text into the agent composer becomes a
 * chip with the file and lines. Copies are seen two ways, because the desktop app does not always fire a DOM `copy`:
 * - the DOM `copy`/`cut` event (browser, Edit menu roles); here an `application/x-ingot-ref` clipboard entry is added too;
 * - the copy/cut commands (⌘C/⌘X keybindings and the editor's right-click Copy), which in the desktop app write the
 *   editor's text straight to the clipboard without any DOM event.
 */
@injectable()
export class EditorCopyTracker implements FrontendApplicationContribution {

    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;

    protected last?: EditorCopy;

    onStart(): void {
        const onDomCopy = (e: ClipboardEvent) => {
            const copy = this.record(this.focusedEditor());
            if (copy && e.clipboardData) {
                try {
                    e.clipboardData.setData(INGOT_REF_MIME, JSON.stringify({ path: copy.path, uri: copy.uri, start: copy.start, end: copy.end, text: copy.text }));
                } catch {
                    // Custom formats are optional; the in-app record still matches.
                }
            }
        };
        document.addEventListener('copy', onDomCopy, true);
        document.addEventListener('cut', onDomCopy, true);
        this.commands.onWillExecuteCommand(e => {
            if (EDITOR_COPY_COMMANDS.includes(e.commandId)) {
                // Right-click Copy can leave focus on the menu: fall back to the current editor.
                this.record(this.focusedEditor() ?? this.currentEditor());
            }
        });
    }

    get lastCopy(): EditorCopy | undefined {
        return this.last;
    }

    /** The chip for pasted text: from the clipboard's Ingot reference, or the last editor copy with the same text; multi-line only. */
    match(text: string, ref?: string): Omit<ContextChip, 'id'> | undefined {
        if (!text || lineCount(text) < 2) {
            return undefined;
        }
        const fromClipboard = parseIngotRef(ref);
        if (fromClipboard && sameClipboardText(text, fromClipboard.text)) {
            return fromClipboard;
        }
        if (this.last && sameClipboardText(text, this.last.text)) {
            const { at: _at, ...chip } = this.last;
            return chip;
        }
        return undefined;
    }

    /** The current editor's selection as chip data, or undefined when nothing is selected. */
    selection(editor: MonacoEditor | undefined = this.currentEditor()): Omit<ContextChip, 'id'> | undefined {
        if (!editor) {
            return undefined;
        }
        const control = editor.getControl();
        const selection = control.getSelection();
        const model = control.getModel();
        if (!selection || !model || selection.isEmpty()) {
            return undefined;
        }
        const text = model.getValueInRange(selection);
        // A selection ending at column 1 of the next line does not include that line.
        const end = selection.endColumn === 1 && selection.endLineNumber > selection.startLineNumber ? selection.endLineNumber - 1 : selection.endLineNumber;
        const uri = new URI(model.uri.toString());
        const root = this.workspace.tryGetRoots().find(r => r.resource.isEqualOrParent(uri));
        const path = root ? root.resource.relative(uri)?.toString() ?? uri.path.base : uri.path.base;
        return { path, uri: uri.toString(), start: selection.startLineNumber, end, text };
    }

    protected record(editor: MonacoEditor | undefined): EditorCopy | undefined {
        const selection = this.selection(editor);
        if (selection) {
            this.last = { ...selection, at: Date.now() };
        }
        return selection && this.last;
    }

    protected currentEditor(): MonacoEditor | undefined {
        const editor = this.editors.currentEditor?.editor;
        return editor instanceof MonacoEditor ? editor : undefined;
    }

    protected focusedEditor(): MonacoEditor | undefined {
        for (const widget of this.editors.all) {
            if (widget.editor instanceof MonacoEditor && widget.editor.isFocused()) {
                return widget.editor;
            }
        }
        const current = this.currentEditor();
        return current && document.activeElement && current.getControl().getDomNode()?.contains(document.activeElement) ? current : undefined;
    }
}
