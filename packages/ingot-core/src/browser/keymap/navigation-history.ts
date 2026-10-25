import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import type { EditorWidget } from '@theia/editor/lib/browser/editor-widget';
import URI from '@theia/core/lib/common/uri';

export interface RecentLocation {
    readonly uri: string;
    readonly line: number;
    readonly character: number;
    readonly text: string;
}

const MAX_FILES = 50;
const MAX_LOCATIONS = 30;
/** Cursor moves within this many lines update the last location instead of adding one. */
const SAME_PLACE_LINES = 5;

/** Recent Files (Cmd+E) and Recent Locations (Cmd+Shift+E) history (IDEA-17). */
@injectable()
export class NavigationHistory {

    @inject(EditorManager) protected readonly editors: EditorManager;

    protected readonly fileUris: string[] = [];
    protected readonly places: RecentLocation[] = [];
    protected readonly editorListeners = new DisposableCollection();

    @postConstruct()
    protected init(): void {
        this.editors.onCurrentEditorChanged(widget => this.track(widget));
        this.track(this.editors.currentEditor);
    }

    get files(): readonly URI[] {
        return this.fileUris.map(u => new URI(u));
    }

    get locations(): readonly RecentLocation[] {
        return this.places;
    }

    protected track(widget: EditorWidget | undefined): void {
        this.editorListeners.dispose();
        if (!widget) {
            return;
        }
        const uri = widget.editor.uri.toString();
        const existing = this.fileUris.indexOf(uri);
        if (existing >= 0) {
            this.fileUris.splice(existing, 1);
        }
        this.fileUris.unshift(uri);
        this.fileUris.length = Math.min(this.fileUris.length, MAX_FILES);
        const record = (): void => {
            const { line, character } = widget.editor.cursor;
            const text = widget.editor.document.getLineContent(line + 1)?.trim() ?? '';
            const last = this.places[0];
            if (last && last.uri === uri && Math.abs(last.line - line) <= SAME_PLACE_LINES) {
                this.places[0] = { uri, line, character, text };
                return;
            }
            const same = this.places.findIndex(p => p.uri === uri && Math.abs(p.line - line) <= SAME_PLACE_LINES);
            if (same >= 0) {
                this.places.splice(same, 1);
            }
            this.places.unshift({ uri, line, character, text });
            this.places.length = Math.min(this.places.length, MAX_LOCATIONS);
        };
        record();
        this.editorListeners.push(widget.editor.onCursorPositionChanged(() => record()));
    }
}
