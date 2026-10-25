import { inject, injectable } from '@theia/core/shared/inversify';
import * as monaco from '@theia/monaco-editor-core';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { ContextKeyService, type ContextKey } from '@theia/core/lib/browser/context-key-service';
import { HoverService } from '@theia/core/lib/browser/hover-service';
import { CommandRegistry, type CommandContribution } from '@theia/core/lib/common/command';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { MenuModelRegistry, type MenuContribution } from '@theia/core/lib/common/menu';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { EDITOR_LINENUMBER_CONTEXT_MENU } from '@theia/editor/lib/browser/editor-linenumber-contribution';
import type { EditorWidget } from '@theia/editor/lib/browser/editor-widget';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { ageBuckets, annotationLabel, parseCommitInfo, parseLineHistory, previousRevision, UNCOMMITTED_HASH } from '../../common/git/annotate.utils';
import { GitService, type GitBlameLine } from '../../common/git/git.types';
import { parseBlame, relativeDate } from '../../common/git/git.utils';
import { IngotGitContribution } from '../git/git-contribution';
import { ANNOTATE_COMMANDS, ANNOTATED_CONTEXT_KEY, ANNOTATION_CLASS, ANNOTATION_MIN_CHARS } from './annotate.consts';
import { AnnotationDetailsDialog } from './annotation-details-dialog';

interface Annotation {
    readonly lines: Map<number, GitBlameLine>;
    readonly rev?: string;
    readonly decorations: monaco.editor.IEditorDecorationsCollection;
    readonly toDispose: DisposableCollection;
}

interface Target {
    readonly editor: MonacoEditor;
    readonly root: string;
    readonly relative: string;
}

type LineArg = { lineNumber?: number } | undefined;

/**
 * Annotate with Git Blame (IDEA-83): clicking the line-number gutter (or right-click > Annotate) shows the date and
 * author of every line in the gutter, shaded by age; hovering shows the commit; clicking an annotation opens the
 * commit details and the line's history back to the commit that introduced it.
 */
@injectable()
export class IngotAnnotateContribution implements FrontendApplicationContribution, CommandContribution, MenuContribution {

    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(GitService) protected readonly git: GitService;
    @inject(HoverService) protected readonly hover: HoverService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(ClipboardService) protected readonly clipboard: ClipboardService;
    @inject(ContextKeyService) protected readonly contextKeys: ContextKeyService;
    @inject(IngotGitContribution) protected readonly gitLog: IngotGitContribution;

    protected readonly annotations = new Map<MonacoEditor, Annotation>();
    protected annotatedKey: ContextKey<boolean>;

    onStart(): void {
        this.annotatedKey = this.contextKeys.createKey<boolean>(ANNOTATED_CONTEXT_KEY, false);
        this.editors.all.forEach(w => this.attach(w));
        this.editors.onCreated(w => this.attach(w));
        this.editors.onCurrentEditorChanged(() => this.updateContextKey());
    }

    isAnnotated(editor: MonacoEditor | undefined): boolean {
        return !!editor && this.annotations.has(editor);
    }

    protected updateContextKey(): void {
        this.annotatedKey?.set(this.isAnnotated(this.current()));
    }

    protected current(): MonacoEditor | undefined {
        const editor = this.editors.currentEditor?.editor;
        return editor instanceof MonacoEditor ? editor : undefined;
    }

    protected attach(widget: EditorWidget): void {
        const editor = widget.editor;
        if (!(editor instanceof MonacoEditor)) {
            return;
        }
        const control = editor.getControl();
        const isLineNumber = (e: monaco.editor.IEditorMouseEvent): boolean => e.target.type === monaco.editor.MouseTargetType.GUTTER_LINE_NUMBERS;
        const toDispose = new DisposableCollection(
            control.onMouseDown(e => {
                if (!isLineNumber(e) || !e.event.leftButton || e.event.ctrlKey || e.event.metaKey || e.event.shiftKey || e.event.altKey) {
                    return;
                }
                const line = e.target.position?.lineNumber;
                if (this.isAnnotated(editor)) {
                    if (line) {
                        // Let Monaco finish its own mouse handling before a modal takes focus.
                        setTimeout(() => void this.showDetails(editor, line));
                    }
                } else {
                    void this.annotate(editor);
                }
            }),
            control.onMouseMove(e => {
                const annotation = this.annotations.get(editor);
                const line = e.target.position?.lineNumber;
                const blame = line ? annotation?.lines.get(line) : undefined;
                if (isLineNumber(e) && blame && e.target.element) {
                    this.hover.requestHover({ content: this.hoverContent(blame), target: e.target.element, position: 'right' });
                }
            }),
            editor.document.onDidSaveModel(() => {
                const annotation = this.annotations.get(editor);
                if (annotation && !annotation.rev) {
                    void this.annotate(editor);
                }
            })
        );
        widget.disposed.connect(() => {
            this.close(editor);
            toDispose.dispose();
        });
    }

    protected hoverContent(blame: GitBlameLine): HTMLElement {
        const node = document.createElement('div');
        node.className = 'ingot-annotation-hover';
        const head = node.appendChild(document.createElement('div'));
        head.className = 'ingot-annotation-hover-head';
        if (blame.hash === UNCOMMITTED_HASH) {
            head.textContent = 'Not committed yet';
            return node;
        }
        const hash = head.appendChild(document.createElement('span'));
        hash.className = 'ingot-annotation-hash';
        hash.textContent = blame.hash.slice(0, 8);
        head.append(` · ${blame.author} · ${blame.date ? `${new Date(blame.date).toLocaleString()} (${relativeDate(blame.date)})` : ''}`);
        const message = node.appendChild(document.createElement('div'));
        message.className = 'ingot-annotation-hover-message';
        message.textContent = blame.summary;
        const hint = node.appendChild(document.createElement('div'));
        hint.className = 'ingot-annotation-hover-hint';
        hint.textContent = 'Click for commit details and line history';
        return node;
    }

    protected target(editor: MonacoEditor): Target | undefined {
        const uri = editor.uri;
        const root = this.workspace.tryGetRoots().map(r => r.resource).find(r => r.isEqualOrParent(uri));
        const relative = root?.relative(uri)?.toString();
        return root && relative ? { editor, root: root.path.fsPath(), relative } : undefined;
    }

    /** Annotates the editor at `rev` (or the working tree), replacing any annotation it already has. */
    async annotate(editor: MonacoEditor, rev?: string): Promise<void> {
        const t = this.target(editor);
        if (!t) {
            this.messages.info('Annotate: the file is not in a Git repository.');
            return;
        }
        let lines: GitBlameLine[];
        try {
            lines = rev ? parseBlame((await this.git.run(t.root, { kind: 'blameAt', path: t.relative, rev })).output) : await this.git.blame(t.root, t.relative);
        } catch (error) {
            this.messages.error(`Annotate: ${error instanceof Error ? error.message : String(error)}`);
            return;
        }
        this.close(editor);
        const control = editor.getControl();
        const byLine = new Map(lines.map(l => [l.line, l]));
        const buckets = ageBuckets(lines);
        const digits = Math.max(3, String(editor.document.lineCount).length);
        // getRawOptions() is live, so keep the plain values to restore on close.
        const { lineNumbers: previousLineNumbers, lineNumbersMinChars: previousMinChars, extraEditorClassName: previousClass } = control.getRawOptions();
        // Monaco rewrites the editor node's className on focus, so the marker class goes through extraEditorClassName.
        control.updateOptions({
            lineNumbers: n => annotationLabel(byLine.get(n), n, digits),
            lineNumbersMinChars: ANNOTATION_MIN_CHARS + digits,
            extraEditorClassName: `${previousClass ?? ''} ingot-annotated`.trim()
        });
        const decorations = control.createDecorationsCollection(lines.map(l => ({
            range: new monaco.Range(l.line, 1, l.line, 1),
            options: { lineNumberClassName: `${ANNOTATION_CLASS} ${ANNOTATION_CLASS}-age-${l.hash === UNCOMMITTED_HASH ? 'new' : buckets.get(l.hash) ?? 0}` }
        })));
        const toDispose = new DisposableCollection({
            dispose: () => {
                decorations.clear();
                control.updateOptions({ lineNumbers: previousLineNumbers ?? 'on', lineNumbersMinChars: previousMinChars ?? 5, extraEditorClassName: previousClass ?? '' });
            }
        });
        this.annotations.set(editor, { lines: byLine, rev, decorations, toDispose });
        this.updateContextKey();
    }

    close(editor: MonacoEditor | undefined): void {
        const annotation = editor && this.annotations.get(editor);
        if (editor && annotation) {
            this.annotations.delete(editor);
            annotation.toDispose.dispose();
            this.hover.cancelHover();
            this.updateContextKey();
        }
    }

    async toggle(editor: MonacoEditor | undefined = this.current()): Promise<void> {
        if (!editor) {
            return;
        }
        if (this.isAnnotated(editor)) {
            this.close(editor);
        } else {
            await this.annotate(editor);
        }
    }

    protected lineOf(editor: MonacoEditor, arg: LineArg): number {
        return arg?.lineNumber ?? editor.cursor.line + 1;
    }

    /** Annotates the revision before the commit that last touched the line. */
    async annotatePrevious(editor: MonacoEditor, line: number, hash?: string): Promise<void> {
        let commit = hash ?? this.annotations.get(editor)?.lines.get(line)?.hash;
        if (!commit) {
            const t = this.target(editor);
            const lines = t ? await this.git.blame(t.root, t.relative) : [];
            commit = lines.find(l => l.line === line)?.hash;
        }
        if (!commit || commit === UNCOMMITTED_HASH) {
            this.messages.info('Annotate Previous Revision: the line has no committed revision yet.');
            return;
        }
        await this.annotate(editor, previousRevision(commit));
    }

    async showDetails(editor: MonacoEditor, line: number): Promise<void> {
        const t = this.target(editor);
        const blame = this.annotations.get(editor)?.lines.get(line) ?? (t ? (await this.git.blame(t.root, t.relative)).find(l => l.line === line) : undefined);
        if (!t || !blame) {
            return;
        }
        if (blame.hash === UNCOMMITTED_HASH) {
            this.messages.info(`Line ${line} has uncommitted changes.`);
            return;
        }
        const history = await this.lineHistory(t, line);
        const action = await new AnnotationDetailsDialog({
            title: `${t.relative.split('/').pop()}:${line} · ${blame.hash.slice(0, 8)}`,
            hash: blame.hash,
            history,
            load: async hash => parseCommitInfo((await this.git.run(t.root, { kind: 'commitInfo', commit: hash })).output)
        }).open();
        if (action?.kind === 'log') {
            const log = await this.gitLog.openView({ activate: true, reveal: true });
            await log.refresh(t.relative);
            await log.selectHash(action.hash);
        } else if (action?.kind === 'previous') {
            await this.annotatePrevious(editor, line, action.hash);
        } else if (action?.kind === 'copy') {
            await this.clipboard.writeText(action.hash);
        }
    }

    protected async lineHistory(t: Target, line: number): Promise<ReturnType<typeof parseLineHistory>> {
        try {
            return parseLineHistory((await this.git.run(t.root, { kind: 'logLines', path: t.relative, start: line, end: line })).output);
        } catch {
            return [];
        }
    }

    async showLineHistory(editor: MonacoEditor, line: number): Promise<void> {
        await this.showDetails(editor, line);
    }

    registerCommands(registry: CommandRegistry): void {
        const C = ANNOTATE_COMMANDS;
        const withEditor = (run: (editor: MonacoEditor, arg: LineArg) => unknown, visible?: (editor: MonacoEditor) => boolean) => ({
            execute: (arg?: LineArg) => {
                const editor = this.current();
                return editor ? run(editor, arg) : undefined;
            },
            isEnabled: () => !!this.current(),
            isVisible: () => {
                const editor = this.current();
                return !!editor && (!visible || visible(editor));
            }
        });
        registry.registerCommand(C.toggle, withEditor(editor => this.toggle(editor), editor => !this.isAnnotated(editor)));
        registry.registerCommand(C.close, withEditor(editor => this.close(editor), editor => this.isAnnotated(editor)));
        registry.registerCommand(C.previous, withEditor((editor, arg) => this.annotatePrevious(editor, this.lineOf(editor, arg))));
        registry.registerCommand(C.lineHistory, withEditor((editor, arg) => this.showLineHistory(editor, this.lineOf(editor, arg))));
        registry.registerCommand(C.details, withEditor((editor, arg) => this.showDetails(editor, this.lineOf(editor, arg)), editor => this.isAnnotated(editor)));
    }

    registerMenus(menus: MenuModelRegistry): void {
        const C = ANNOTATE_COMMANDS;
        const group = [...EDITOR_LINENUMBER_CONTEXT_MENU, '0_ingot_annotate'];
        menus.registerMenuAction(group, { commandId: C.toggle.id, label: 'Annotate with Git Blame', order: 'a' });
        menus.registerMenuAction(group, { commandId: C.close.id, label: 'Close Annotations', order: 'b' });
        menus.registerMenuAction(group, { commandId: C.details.id, label: 'Show Annotation Details', order: 'c' });
        menus.registerMenuAction(group, { commandId: C.previous.id, label: 'Annotate Previous Revision', order: 'd' });
        menus.registerMenuAction(group, { commandId: C.lineHistory.id, label: 'Show History for Line', order: 'e' });
    }
}
