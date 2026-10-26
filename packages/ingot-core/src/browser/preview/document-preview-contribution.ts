import { inject, injectable } from '@theia/core/shared/inversify';
import * as monaco from '@theia/monaco-editor-core';
import {
    ApplicationShell, KeybindingContribution, KeybindingRegistry, NavigatableWidgetOpenHandler, StatusBar, StatusBarAlignment, WidgetManager,
    type FrontendApplicationContribution, type Widget
} from '@theia/core/lib/browser';
import { ContextKeyService, type ContextKey } from '@theia/core/lib/browser/context-key-service';
import type { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import { ThemeService } from '@theia/core/lib/browser/theming';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import URI from '@theia/core/lib/common/uri';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { MonacoEditor } from '@theia/monaco/lib/browser/monaco-editor';
import {
    MARKDOWN_COMMANDS, MARKDOWN_MODE_CONTEXT, MARKDOWN_MODE_TOOLTIPS, MARKDOWN_MODES, MARKDOWN_PREVIEW_WIDGET_ID, PDF_COMMANDS, PDF_STATUS_ID,
    PDF_VIEWER_WIDGET_ID, SCROLL_SYNC_LOCK_MS
} from '../../common/preview/document-preview.consts';
import { formatScale, isMarkdownPath, isPdfPath } from '../../common/preview/document-preview.utils';
import { MarkdownPreviewWidget } from './markdown-preview-widget';
import { PdfViewerWidget } from './pdf-viewer-widget';

const PREVIEW_SCHEMES = new Set(['file', 'user-storage']);
const PDF_FOCUS_CONTEXT = 'ingotPdfViewerFocus';
export type MarkdownMode = typeof MARKDOWN_MODES[number];

/** IDEA-146: "Open With > Markdown Preview"; the editor stays the default for Markdown files. */
@injectable()
export class MarkdownPreviewOpenHandler extends NavigatableWidgetOpenHandler<MarkdownPreviewWidget> {
    readonly id = MARKDOWN_PREVIEW_WIDGET_ID;
    readonly label = 'Markdown Preview';

    canHandle(uri: URI): number {
        return PREVIEW_SCHEMES.has(uri.scheme) && isMarkdownPath(uri.path.base) ? 50 : 0;
    }
}

/** IDEA-146: PDF files open in the built-in viewer. */
@injectable()
export class PdfViewerOpenHandler extends NavigatableWidgetOpenHandler<PdfViewerWidget> {
    readonly id = PDF_VIEWER_WIDGET_ID;
    readonly label = 'PDF Viewer';

    canHandle(uri: URI): number {
        return PREVIEW_SCHEMES.has(uri.scheme) && isPdfPath(uri.path.base) ? 500 : 0;
    }
}

/**
 * IDEA-146: Markdown Code / Preview / Side by side in the editor toolbar with two-way scroll sync, and the PDF
 * viewer's status bar entry and shortcuts.
 */
@injectable()
export class DocumentPreviewContribution implements FrontendApplicationContribution, CommandContribution, TabBarToolbarContribution, KeybindingContribution {

    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(StatusBar) protected readonly statusBar: StatusBar;
    @inject(WidgetManager) protected readonly widgets: WidgetManager;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(ContextKeyService) protected readonly contextKeys: ContextKeyService;
    @inject(ThemeService) protected readonly themes: ThemeService;
    @inject(MarkdownPreviewOpenHandler) protected readonly previewOpener: MarkdownPreviewOpenHandler;

    protected modeKey: ContextKey<string>;
    protected pdfFocusKey: ContextKey<boolean>;
    /** Per document: the side being scrolled by code ignores its own scroll events until then. */
    protected readonly editorLockUntil = new Map<string, number>();

    onStart(): void {
        this.modeKey = this.contextKeys.createKey<string>(MARKDOWN_MODE_CONTEXT, '');
        this.pdfFocusKey = this.contextKeys.createKey<boolean>(PDF_FOCUS_CONTEXT, false);
        this.widgets.onDidCreateWidget(({ factoryId, widget }) => {
            if (factoryId === MARKDOWN_PREVIEW_WIDGET_ID && widget instanceof MarkdownPreviewWidget) {
                this.trackPreview(widget);
            } else if (factoryId === PDF_VIEWER_WIDGET_ID && widget instanceof PdfViewerWidget) {
                widget.onDidChangeInfo(() => this.updateStatus());
                widget.disposed.connect(() => this.updateStatus());
            }
        });
        this.editors.all.forEach(editor => this.trackEditor(editor));
        this.editors.onCreated(editor => this.trackEditor(editor));
        const refresh = () => {
            this.updateStatus();
            this.updateModeKey();
        };
        this.shell.onDidChangeCurrentWidget(refresh);
        this.shell.onDidAddWidget(refresh);
        this.shell.onDidRemoveWidget(refresh);
        this.themes.onDidColorThemeChange(() => this.previews().forEach(preview => preview.refreshTheme()));
    }

    registerCommands(registry: CommandRegistry): void {
        for (const mode of MARKDOWN_MODES) {
            registry.registerCommand(MARKDOWN_COMMANDS[mode], {
                isEnabled: (widget?: Widget) => !!this.markdownUri(widget),
                isVisible: (widget?: Widget) => !!this.markdownUri(widget),
                isToggled: (widget?: Widget) => {
                    const uri = this.markdownUri(widget);
                    return !!uri && this.modeOf(uri) === mode;
                },
                execute: (widget?: Widget) => {
                    const uri = this.markdownUri(widget);
                    return uri && this.setMode(uri, mode);
                }
            });
        }
        const pdf = () => this.shell.currentWidget instanceof PdfViewerWidget ? this.shell.currentWidget : undefined;
        const onPdf = { isEnabled: () => !!pdf(), isVisible: () => !!pdf() };
        registry.registerCommand(PDF_COMMANDS.find, { ...onPdf, execute: () => pdf()?.focusSearch() });
        registry.registerCommand(PDF_COMMANDS.zoomIn, { ...onPdf, execute: () => pdf()?.zoomBy(1) });
        registry.registerCommand(PDF_COMMANDS.zoomOut, { ...onPdf, execute: () => pdf()?.zoomBy(-1) });
    }

    registerKeybindings(registry: KeybindingRegistry): void {
        registry.registerKeybinding({ command: PDF_COMMANDS.find.id, keybinding: 'ctrlcmd+f', when: PDF_FOCUS_CONTEXT });
        registry.registerKeybinding({ command: PDF_COMMANDS.zoomIn.id, keybinding: 'ctrlcmd+=', when: PDF_FOCUS_CONTEXT });
        registry.registerKeybinding({ command: PDF_COMMANDS.zoomOut.id, keybinding: 'ctrlcmd+-', when: PDF_FOCUS_CONTEXT });
    }

    registerToolbarItems(registry: TabBarToolbarRegistry): void {
        MARKDOWN_MODES.forEach((mode, index) => registry.registerItem({
            id: MARKDOWN_COMMANDS[mode].id, command: MARKDOWN_COMMANDS[mode].id, icon: MARKDOWN_COMMANDS[mode].iconClass,
            tooltip: MARKDOWN_MODE_TOOLTIPS[mode], group: 'navigation', priority: index, isVisible: (widget?: Widget) => !!this.markdownUri(widget)
        }));
    }

    protected markdownUri(widget?: Widget): URI | undefined {
        const target = widget ?? this.shell.currentWidget;
        if (target instanceof MarkdownPreviewWidget) {
            return target.getResourceUri();
        }
        const uri = target instanceof EditorWidget ? target.editor.uri : undefined;
        return uri && isMarkdownPath(uri.path.base) ? uri : undefined;
    }

    protected editorFor(uri: URI): EditorWidget | undefined {
        return this.shell.getWidgets('main').find((w): w is EditorWidget => w instanceof EditorWidget && w.editor.uri.isEqual(uri));
    }

    protected previewFor(uri: URI): MarkdownPreviewWidget | undefined {
        return this.previews().find(w => w.getResourceUri().isEqual(uri));
    }

    protected previews(): MarkdownPreviewWidget[] {
        return this.shell.getWidgets('main').filter((w): w is MarkdownPreviewWidget => w instanceof MarkdownPreviewWidget);
    }

    modeOf(uri: URI): MarkdownMode {
        const editor = this.editorFor(uri);
        const preview = this.previewFor(uri);
        if (editor?.isVisible && preview?.isVisible) {
            return 'split';
        }
        return preview && (preview.isVisible || !editor) ? 'preview' : 'code';
    }

    protected updateModeKey(): void {
        const uri = this.markdownUri();
        this.modeKey.set(uri ? `${uri.toString()}:${this.modeOf(uri)}` : '');
        this.pdfFocusKey.set(this.shell.currentWidget instanceof PdfViewerWidget);
    }

    /** Code: the editor replaces the preview. Preview: the preview replaces the editor. Side by side: both, preview on the right. */
    async setMode(uri: URI, mode: MarkdownMode): Promise<void> {
        let editor = this.editorFor(uri);
        let preview = this.previewFor(uri);
        if (mode === 'code') {
            editor = editor ?? await this.editors.open(uri, { mode: 'activate', widgetOptions: preview ? { ref: preview, mode: 'tab-after' } : undefined });
            await this.shell.activateWidget(editor.id);
            preview?.close();
        } else if (mode === 'preview') {
            preview = preview ?? await this.previewOpener.open(uri, { mode: 'activate', widgetOptions: editor ? { ref: editor, mode: 'tab-after' } : undefined });
            if (editor && editor.saveable.dirty) {
                // Keep unsaved changes: the editor tab moves behind the preview instead of closing.
                if (this.shell.getTabBarFor(editor) !== this.shell.getTabBarFor(preview)) {
                    await this.shell.addWidget(editor, { area: 'main', ref: preview, mode: 'tab-before' });
                }
            } else {
                editor?.close();
            }
            await this.shell.activateWidget(preview.id);
        } else {
            editor = editor ?? await this.editors.open(uri, { mode: 'activate', widgetOptions: preview ? { ref: preview, mode: 'split-left' } : undefined });
            if (!preview) {
                preview = await this.previewOpener.open(uri, { mode: 'reveal', widgetOptions: { ref: editor, mode: 'split-right' } });
            } else if (this.shell.getTabBarFor(editor) === this.shell.getTabBarFor(preview)) {
                await this.shell.addWidget(preview, { area: 'main', ref: editor, mode: 'split-right' });
            }
            await this.shell.revealWidget(preview.id);
            await this.shell.activateWidget(editor.id);
            this.syncPreviewTo(editor, preview);
        }
        this.updateModeKey();
    }

    protected trackEditor(editor: EditorWidget): void {
        const uri = editor.editor.uri;
        if (!isMarkdownPath(uri.path.base) || !(editor.editor instanceof MonacoEditor)) {
            return;
        }
        const control = editor.editor.getControl();
        const listener = control.onDidScrollChange(event => {
            if (!event.scrollTopChanged || Date.now() < (this.editorLockUntil.get(uri.toString()) ?? 0)) {
                return;
            }
            const preview = this.previewFor(uri);
            if (preview?.isVisible && editor.isVisible) {
                this.syncPreviewTo(editor, preview);
            }
        });
        editor.disposed.connect(() => listener.dispose());
    }

    protected trackPreview(preview: MarkdownPreviewWidget): void {
        const uri = preview.getResourceUri();
        preview.trackDisposable(preview.onDidScrollToLine(line => {
            const editor = this.editorFor(uri);
            if (editor?.isVisible && editor.editor instanceof MonacoEditor) {
                const control = editor.editor.getControl();
                const whole = Math.floor(line);
                const lineHeight = control.getOption(monaco.editor.EditorOption.lineHeight);
                this.editorLockUntil.set(uri.toString(), Date.now() + SCROLL_SYNC_LOCK_MS);
                control.setScrollTop(control.getTopForLineNumber(whole + 1) + (line - whole) * lineHeight);
            }
        }));
        preview.trackDisposable(preview.onDidRender(() => {
            const editor = this.editorFor(uri);
            if (editor?.isVisible && preview.isVisible) {
                this.syncPreviewTo(editor, preview);
            }
        }));
    }

    /** Puts the editor's top line at the top of the preview. */
    protected syncPreviewTo(editor: EditorWidget, preview: MarkdownPreviewWidget): void {
        if (!(editor.editor instanceof MonacoEditor)) {
            return;
        }
        const control = editor.editor.getControl();
        const top = control.getScrollTop();
        const first = control.getVisibleRanges()[0]?.startLineNumber ?? 1;
        const lineHeight = Math.max(1, control.getOption(monaco.editor.EditorOption.lineHeight));
        const offset = Math.max(0, Math.min(1, (top - control.getTopForLineNumber(first)) / lineHeight));
        preview.scrollToLine(top <= 0 ? 0 : first - 1 + offset);
    }

    protected updateStatus(): void {
        const widget = this.shell.currentWidget;
        const info = widget instanceof PdfViewerWidget && !widget.isDisposed ? widget.info : undefined;
        if (!info || !(widget instanceof PdfViewerWidget)) {
            this.statusBar.removeElement(PDF_STATUS_ID);
            return;
        }
        this.statusBar.setElement(PDF_STATUS_ID, {
            text: `$(file-pdf) Page ${info.page} of ${info.pages} · ${formatScale(info.scale)} · ${widget.fileSize}`,
            tooltip: 'Current page, zoom and file size', alignment: StatusBarAlignment.RIGHT, priority: 20
        });
    }
}

