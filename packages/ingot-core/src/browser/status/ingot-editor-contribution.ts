import { injectable } from '@theia/core/shared/inversify';
import { StatusBarAlignment, type StatusBar } from '@theia/core/lib/browser/status-bar';
import { EditorContribution } from '@theia/editor/lib/browser/editor-contribution';
import { EditorCommands } from '@theia/editor/lib/browser/editor-command';
import type { TextEditor } from '@theia/editor/lib/browser/editor';
import { formatCursorPosition } from '../../common/vcs/vcs.utils';

const CURSOR_STATUS_ID = 'editor-status-cursor-position';

/** JetBrains-style caret position in the status bar: `12:5` instead of `Ln 12, Col 5`. */
@injectable()
export class IngotEditorContribution extends EditorContribution {

    protected override setCursorPositionStatus(statusBar: StatusBar, editor?: TextEditor): void {
        if (!editor) {
            statusBar.removeElement(CURSOR_STATUS_ID);
            return;
        }
        statusBar.setElement(CURSOR_STATUS_ID, {
            text: formatCursorPosition(editor.cursor.line, editor.getVisibleColumn(editor.cursor)),
            alignment: StatusBarAlignment.RIGHT,
            priority: 100,
            tooltip: EditorCommands.GOTO_LINE_COLUMN.label,
            command: EditorCommands.GOTO_LINE_COLUMN.id
        });
    }
}
