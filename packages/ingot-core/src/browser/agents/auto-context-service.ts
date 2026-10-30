import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { Emitter, type Event } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import { EditorManager, type EditorWidget } from '@theia/editor/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { ProblemManager } from '@theia/markers/lib/browser/problem/problem-manager';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { autoContextItems, fileContext, recentEdits, recordEdit, visibleAutoContext } from '../../common/agents/auto-context';
import { AUTO_CONTEXT_DEBOUNCE_MS, DIFF_DEBOUNCE_MS, LSP_SEVERITY, LSP_SEVERITY_ERROR } from '../../common/agents/auto-context.consts';
import type { AutoAttach, AutoContextItem, AutoDiagnostic, AutoEdit, AutoSelection, DiagnosticSeverity } from '../../common/agents/auto-context.types';
import { GitService } from '../../common/git/git.types';
import { MemoryStore } from './memory-store';

/**
 * IDEA-267: keeps the composer's auto-context chips current — the file and selection in the last active editor,
 * the editor's problems, files the user just edited, the uncommitted git diff and the memory count.
 */
@injectable()
export class AutoContextService {

    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(ProblemManager) protected readonly problems: ProblemManager;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(GitService) protected readonly git: GitService;
    @inject(MemoryStore) protected readonly memoryStore: MemoryStore;
    @inject(FileService) protected readonly files: FileService;

    protected readonly onDidChangeEmitter = new Emitter<void>();
    readonly onDidChange: Event<void> = this.onDidChangeEmitter.event;
    protected readonly editorListeners = new DisposableCollection();
    protected all: AutoContextItem[] = [];
    protected dismissed = new Set<string>();
    protected edits: AutoEdit[] = [];
    protected diff = '';
    protected refreshTimer?: ReturnType<typeof setTimeout>;
    protected diffTimer?: ReturnType<typeof setTimeout>;

    @postConstruct()
    protected init(): void {
        this.editors.onCurrentEditorChanged(editor => {
            this.watch(editor);
            this.schedule();
        });
        this.editors.onCreated(widget => widget.editor.onDocumentContentChanged(e => this.onEdit(widget, e.contentChanges.map(c => c.range.start.line + 1))));
        this.problems.onDidChangeMarkers(() => this.schedule());
        this.memoryStore.onDidChange(() => this.schedule());
        this.files.onDidFilesChange(() => this.scheduleDiff());
        this.workspace.onWorkspaceChanged(() => {
            void this.memoryStore.load().catch(() => undefined);
            this.scheduleDiff();
        });
        this.watch(this.editors.currentEditor);
        void this.workspace.ready.then(() => {
            void this.memoryStore.load().catch(() => undefined);
            this.scheduleDiff();
        });
    }

    /** Chips the user has not removed. */
    get items(): readonly AutoContextItem[] {
        return visibleAutoContext(this.all, this.dismissed);
    }

    /** What a send attaches: the chips on screen, and whether memories stay on. */
    get attach(): AutoAttach {
        const items = this.items;
        return { items, skipMemories: this.all.some(item => item.kind === 'memory' && this.dismissed.has(item.key)) };
    }

    dismiss(key: string): void {
        this.dismissed.add(key);
        this.onDidChangeEmitter.fire();
    }

    /** Brings back every removed chip. */
    restoreAll(): void {
        this.dismissed.clear();
        this.onDidChangeEmitter.fire();
    }

    get hasDismissed(): boolean {
        return this.all.some(item => this.dismissed.has(item.key));
    }

    /** Re-reads everything now (the panel calls this when it opens, and after a reply changed files). */
    refresh(): void {
        this.scheduleDiff(0);
        this.schedule(0);
    }

    protected watch(editor: EditorWidget | undefined): void {
        this.editorListeners.dispose();
        if (editor) {
            this.editorListeners.push(editor.editor.onSelectionChanged(() => this.schedule()));
            this.editorListeners.push(editor.editor.onCursorPositionChanged(() => this.schedule()));
        }
    }

    protected onEdit(widget: EditorWidget, lines: readonly number[]): void {
        const path = this.relative(widget.editor.uri);
        if (!path) {
            return;
        }
        this.edits = recordEdit(this.edits, path, lines, Date.now());
        this.schedule();
        this.scheduleDiff();
    }

    protected schedule(delay = AUTO_CONTEXT_DEBOUNCE_MS): void {
        clearTimeout(this.refreshTimer);
        this.refreshTimer = setTimeout(() => this.rebuild(), delay);
    }

    protected scheduleDiff(delay = DIFF_DEBOUNCE_MS): void {
        clearTimeout(this.diffTimer);
        this.diffTimer = setTimeout(() => void this.loadDiff(), delay);
    }

    protected root(): URI | undefined {
        return this.workspace.tryGetRoots()[0]?.resource;
    }

    /** Workspace-relative path, or undefined outside the workspace (those files are not attached). */
    protected relative(uri: URI): string | undefined {
        const root = this.root();
        return root?.isEqualOrParent(uri) ? root.relative(uri)?.toString() : undefined;
    }

    protected async loadDiff(): Promise<void> {
        const root = this.root();
        const diff = root ? (await this.git.run(root.path.fsPath(), { kind: 'diff' }).catch(() => ({ output: '' }))).output : '';
        if (diff !== this.diff) {
            this.diff = diff;
            this.rebuild();
        }
    }

    protected selection(editor: EditorWidget, path: string): AutoSelection | undefined {
        const range = editor.editor.selection;
        if (range.start.line === range.end.line && range.start.character === range.end.character) {
            return undefined;
        }
        const text = editor.editor.document.getText(range);
        // A selection that ends at column 0 of the next line covers the lines before it.
        const end = range.end.character === 0 && range.end.line > range.start.line ? range.end.line : range.end.line + 1;
        return text.trim() ? { path, uri: editor.editor.uri.toString(), start: range.start.line + 1, end, text } : undefined;
    }

    protected diagnostics(): AutoDiagnostic[] {
        const out: AutoDiagnostic[] = [];
        for (const marker of this.problems.findMarkers()) {
            const path = this.relative(new URI(marker.uri));
            const severity: DiagnosticSeverity | undefined = LSP_SEVERITY[marker.data.severity ?? LSP_SEVERITY_ERROR];
            if (!path || !severity) {
                continue;
            }
            out.push({ path, line: marker.data.range.start.line + 1, severity, message: marker.data.message.split('\n')[0], source: marker.data.source });
        }
        return out;
    }

    protected rebuild(): void {
        const editor = this.editors.currentEditor;
        const path = editor ? this.relative(editor.editor.uri) : undefined;
        const now = Date.now();
        this.all = autoContextItems({
            file: editor && path ? fileContext(path, editor.editor.uri.toString(), editor.editor.document.getText(), editor.editor.cursor.line + 1) : undefined,
            selection: editor && path ? this.selection(editor, path) : undefined,
            diagnostics: this.diagnostics(),
            edits: recentEdits(this.edits, now),
            diff: this.diff,
            memories: this.memoryStore.memories.length
        });
        this.onDidChangeEmitter.fire();
    }
}
