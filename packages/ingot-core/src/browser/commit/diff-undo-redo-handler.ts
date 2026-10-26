import { inject, injectable } from '@theia/core/shared/inversify';
import { ApplicationShell, type UndoRedoHandler } from '@theia/core/lib/browser';
import { DIFF_UNDO_PRIORITY } from './commit.consts';
import { IngotDiffWidget } from './ingot-diff-widget';

/** Edit › Undo / Redo (⌘Z, Ctrl+Z) while focus is in the diff viewer: undo there, including a chunk revert. */
@injectable()
export class DiffUndoRedoHandler implements UndoRedoHandler<IngotDiffWidget> {
    readonly priority = DIFF_UNDO_PRIORITY;

    @inject(ApplicationShell) protected readonly shell: ApplicationShell;

    select(): IngotDiffWidget | undefined {
        const focused = document.activeElement;
        return [this.shell.activeWidget, this.shell.currentWidget].find(
            (w): w is IngotDiffWidget => w instanceof IngotDiffWidget && !!focused && w.node.contains(focused)
        );
    }

    undo(widget: IngotDiffWidget): void {
        widget.undo();
    }

    redo(widget: IngotDiffWidget): void {
        widget.redo();
    }
}
