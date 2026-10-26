import { inject, injectable } from '@theia/core/shared/inversify';
import * as monaco from '@theia/monaco-editor-core';
import {
    ApplicationShell, NavigatableWidgetOpenHandler, StatusBar, StatusBarAlignment, WidgetManager,
    type FrontendApplicationContribution, type Widget
} from '@theia/core/lib/browser';
import type { TabBarToolbarContribution, TabBarToolbarRegistry } from '@theia/core/lib/browser/shell/tab-bar-toolbar';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import URI from '@theia/core/lib/common/uri';
import { EditorManager, EditorWidget } from '@theia/editor/lib/browser';
import { IMAGE_PREVIEW_COMMANDS, IMAGE_PREVIEW_WIDGET_ID, IMAGE_STATUS_ID } from '../../common/preview/image-preview.consts';
import { findImageRefAt, formatBytes, formatZoom, isImagePath, isSvgPath } from '../../common/preview/image-preview.utils';
import { ImageHoverService } from './image-hover-service';
import { ImagePreviewWidget, type SvgMode } from './image-preview-widget';

const PREVIEW_SCHEMES = new Set(['file', 'user-storage']);

/** IDEA-145: opens image files in the preview instead of a text or binary editor. */
@injectable()
export class ImagePreviewOpenHandler extends NavigatableWidgetOpenHandler<ImagePreviewWidget> {
    readonly id = IMAGE_PREVIEW_WIDGET_ID;
    readonly label = 'Image Preview';

    canHandle(uri: URI): number {
        return PREVIEW_SCHEMES.has(uri.scheme) && isImagePath(uri.path.base) ? 500 : 0;
    }
}

/** IDEA-145: status bar info, zoom commands, SVG Preview / Code / Side by side, and image path hovers in code. */
@injectable()
export class ImagePreviewContribution implements FrontendApplicationContribution, CommandContribution, TabBarToolbarContribution {

    @inject(ApplicationShell) protected readonly shell: ApplicationShell;
    @inject(StatusBar) protected readonly statusBar: StatusBar;
    @inject(WidgetManager) protected readonly widgets: WidgetManager;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(ImagePreviewOpenHandler) protected readonly opener: ImagePreviewOpenHandler;
    @inject(ImageHoverService) protected readonly hovers: ImageHoverService;

    onStart(): void {
        this.widgets.onDidCreateWidget(({ factoryId, widget }) => {
            if (factoryId === IMAGE_PREVIEW_WIDGET_ID && widget instanceof ImagePreviewWidget) {
                widget.onDidChangeInfo(() => this.updateStatus());
                widget.onDidRequestMode(mode => void this.setSvgMode(widget, mode));
                widget.disposed.connect(() => this.updateStatus());
            }
        });
        this.shell.onDidChangeCurrentWidget(() => this.updateStatus());
        monaco.languages.registerHoverProvider('*', { provideHover: (model, position) => this.provideHover(model, position) });
    }

    registerCommands(registry: CommandRegistry): void {
        const current = () => this.shell.currentWidget instanceof ImagePreviewWidget ? this.shell.currentWidget : undefined;
        const onPreview = { isEnabled: () => !!current(), isVisible: () => !!current() };
        registry.registerCommand(IMAGE_PREVIEW_COMMANDS.zoomIn, { ...onPreview, execute: () => current()?.zoomBy(1) });
        registry.registerCommand(IMAGE_PREVIEW_COMMANDS.zoomOut, { ...onPreview, execute: () => current()?.zoomBy(-1) });
        registry.registerCommand(IMAGE_PREVIEW_COMMANDS.fit, { ...onPreview, execute: () => current()?.fitToWindow() });
        registry.registerCommand(IMAGE_PREVIEW_COMMANDS.actual, { ...onPreview, execute: () => current()?.actualSize() });
        registry.registerCommand(IMAGE_PREVIEW_COMMANDS.open, {
            isEnabled: (widget?: Widget) => !!this.editorImageUri(widget),
            isVisible: (widget?: Widget) => !!this.editorImageUri(widget),
            execute: (widget?: Widget) => {
                const editor = this.editorFor(widget);
                const uri = this.editorImageUri(editor);
                return uri && this.opener.open(uri, { mode: 'activate', widgetOptions: editor ? { ref: editor, mode: 'split-right' } : undefined });
            }
        });
    }

    registerToolbarItems(registry: TabBarToolbarRegistry): void {
        registry.registerItem({
            id: IMAGE_PREVIEW_COMMANDS.open.id, command: IMAGE_PREVIEW_COMMANDS.open.id, icon: IMAGE_PREVIEW_COMMANDS.open.iconClass,
            tooltip: 'Open Preview', priority: 0, isVisible: (widget?: Widget) => !!this.editorImageUri(widget)
        });
    }

    protected editorFor(widget?: Widget): EditorWidget | undefined {
        const target = widget ?? this.shell.currentWidget;
        return target instanceof EditorWidget ? target : undefined;
    }

    protected editorImageUri(widget?: Widget): URI | undefined {
        const uri = this.editorFor(widget)?.editor.uri;
        return uri && isSvgPath(uri.path.base) ? uri : undefined;
    }

    /** Preview: nothing to do. Code: the text editor replaces the preview. Side by side: code on the left, preview stays. */
    protected async setSvgMode(widget: ImagePreviewWidget, mode: SvgMode): Promise<void> {
        const uri = widget.getResourceUri();
        if (mode === 'code') {
            await this.editors.open(uri, { mode: 'activate', widgetOptions: { ref: widget, mode: 'tab-after' } });
            widget.close();
        } else if (mode === 'split') {
            await this.editors.open(uri, { mode: 'activate', widgetOptions: { ref: widget, mode: 'split-left' } });
        }
    }

    protected updateStatus(): void {
        const widget = this.shell.currentWidget;
        const info = widget instanceof ImagePreviewWidget && !widget.isDisposed ? widget.info : undefined;
        if (!info || !(widget instanceof ImagePreviewWidget)) {
            this.statusBar.removeElement(IMAGE_STATUS_ID);
            return;
        }
        this.statusBar.setElement(IMAGE_STATUS_ID, {
            text: `$(file-media) ${info.width} × ${info.height} · ${formatBytes(info.bytes)} · ${formatZoom(widget.zoomLevel)}`,
            tooltip: 'Image size, file size and zoom', alignment: StatusBarAlignment.RIGHT, priority: 20
        });
    }

    protected async provideHover(model: monaco.editor.ITextModel, position: monaco.Position): Promise<monaco.languages.Hover | undefined> {
        const ref = findImageRefAt(model.getLineContent(position.lineNumber), position.column - 1);
        if (!ref) {
            return undefined;
        }
        const uri = new URI(model.uri.toString());
        const thumb = await this.hovers.thumbnail(ref.path, uri.parent);
        if (!thumb) {
            return undefined;
        }
        return {
            range: new monaco.Range(position.lineNumber, ref.start + 1, position.lineNumber, ref.end + 1),
            contents: [{ value: this.hovers.hoverMarkdown(thumb) }]
        };
    }
}
