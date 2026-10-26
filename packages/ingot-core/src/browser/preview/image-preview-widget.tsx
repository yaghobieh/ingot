import * as React from '@theia/core/shared/react';
import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { ReactWidget, type Message, type NavigatableWidget, type StatefulWidget } from '@theia/core/lib/browser';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { Emitter } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { MonacoTextModelService } from '@theia/monaco/lib/browser/monaco-text-model-service';
import { IMAGE_PREVIEW_WIDGET_ID, MAX_PREVIEW_BYTES, SVG_MODE_LABELS, SVG_MODES } from '../../common/preview/image-preview.consts';
import { clampZoom, fitZoom, formatBytes, formatZoom, imageMimeType, isSvgPath, nextZoom } from '../../common/preview/image-preview.utils';

export const ImagePreviewUri = Symbol('ImagePreviewUri');
export type SvgMode = typeof SVG_MODES[number];

export interface ImageInfo {
    readonly width: number;
    readonly height: number;
    readonly bytes: number;
}

/**
 * IDEA-145: image editor tab - zoom (buttons, Ctrl/Cmd + wheel, +/-/0 keys), Fit or 100%, checkerboard behind
 * transparency. SVG renders the live text of its model, so edits in a code editor show up as you type.
 */
@injectable()
export class ImagePreviewWidget extends ReactWidget implements NavigatableWidget, StatefulWidget {

    @inject(ImagePreviewUri) protected readonly uri: URI;
    @inject(FileService) protected readonly files: FileService;
    @inject(MonacoTextModelService) protected readonly models: MonacoTextModelService;

    protected src: string | undefined;
    protected error: string | undefined;
    protected bytes = 0;
    protected natural = { width: 0, height: 0 };
    protected zoom = 1;
    protected fitMode = true;
    protected readonly toDisposeOnLoad = new DisposableCollection();
    protected readonly onInfoEmitter = new Emitter<void>();
    readonly onDidChangeInfo = this.onInfoEmitter.event;
    protected readonly onModeEmitter = new Emitter<SvgMode>();
    /** The SVG mode buttons; the contribution opens or closes the code editor. */
    readonly onDidRequestMode = this.onModeEmitter.event;
    protected viewport: HTMLDivElement | null = null;
    protected resizeObserver: ResizeObserver | undefined;

    @postConstruct()
    protected init(): void {
        this.id = `${IMAGE_PREVIEW_WIDGET_ID}:${this.uri.toString()}`;
        this.title.label = this.uri.path.base;
        this.title.caption = this.uri.path.fsPath();
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-file-media';
        this.addClass('ingot-image-preview');
        this.node.tabIndex = 0;
        this.toDispose.pushAll([this.toDisposeOnLoad, this.onInfoEmitter, this.onModeEmitter]);
        this.toDispose.push(this.files.onDidFilesChange(event => {
            if (!this.isSvg && event.contains(this.uri)) {
                void this.load();
            }
        }));
        void this.load();
    }

    get isSvg(): boolean {
        return isSvgPath(this.uri.path.base);
    }

    get info(): ImageInfo | undefined {
        return this.natural.width ? { ...this.natural, bytes: this.bytes } : undefined;
    }

    get zoomLevel(): number {
        return this.zoom;
    }

    getResourceUri(): URI {
        return this.uri;
    }

    createMoveToUri(resourceUri: URI): URI {
        return resourceUri;
    }

    storeState(): object {
        return { zoom: this.zoom, fit: this.fitMode };
    }

    restoreState(state: { zoom?: number; fit?: boolean }): void {
        this.zoom = clampZoom(state.zoom ?? 1);
        this.fitMode = state.fit ?? true;
    }

    zoomBy(direction: 1 | -1): void {
        this.fitMode = false;
        this.zoom = nextZoom(this.zoom, direction);
        this.changed();
    }

    fitToWindow(): void {
        this.fitMode = true;
        this.applyFit();
        this.changed();
    }

    actualSize(): void {
        this.fitMode = false;
        this.zoom = 1;
        this.changed();
    }

    protected changed(): void {
        this.update();
        this.onInfoEmitter.fire();
    }

    protected applyFit(): void {
        const view = this.viewport;
        if (this.fitMode && view && this.natural.width) {
            this.zoom = fitZoom(this.natural.width, this.natural.height, view.clientWidth - 32, view.clientHeight - 32);
        }
    }

    protected async load(): Promise<void> {
        this.toDisposeOnLoad.dispose();
        this.error = undefined;
        try {
            const stat = await this.files.resolve(this.uri, { resolveMetadata: true });
            this.bytes = stat.size ?? 0;
            if (this.bytes > MAX_PREVIEW_BYTES) {
                throw new Error(`The image is too large to preview (${formatBytes(this.bytes)}).`);
            }
            if (this.isSvg) {
                const reference = await this.models.createModelReference(this.uri);
                this.toDisposeOnLoad.push(reference);
                const model = reference.object.textEditorModel;
                this.showSvg(model.getValue());
                this.toDisposeOnLoad.push(model.onDidChangeContent(() => this.showSvg(model.getValue())));
            } else {
                const content = await this.files.readFile(this.uri);
                this.setSource(URL.createObjectURL(new Blob([content.value.buffer as BlobPart], { type: imageMimeType(this.uri.path.base) })));
            }
        } catch (error) {
            this.error = error instanceof Error ? error.message : String(error);
            this.update();
        }
    }

    protected showSvg(text: string): void {
        this.bytes = new TextEncoder().encode(text).length;
        this.setSource(URL.createObjectURL(new Blob([text], { type: 'image/svg+xml' })));
    }

    protected setSource(url: string): void {
        const previous = this.src;
        this.src = url;
        this.toDisposeOnLoad.push({ dispose: () => URL.revokeObjectURL(url) });
        if (previous) {
            // Revoke after the new image has replaced it, so live SVG edits do not flash.
            setTimeout(() => URL.revokeObjectURL(previous), 1000);
        }
        this.update();
    }

    protected onLoaded = (event: React.SyntheticEvent<HTMLImageElement>): void => {
        const img = event.currentTarget;
        const width = img.naturalWidth || 0;
        const height = img.naturalHeight || 0;
        const svgError = this.isSvg && !width;
        this.error = svgError ? 'This SVG has no size or could not be rendered.' : undefined;
        if (width !== this.natural.width || height !== this.natural.height) {
            this.natural = { width, height };
            this.applyFit();
        }
        this.changed();
    };

    protected onBroken = (): void => {
        this.error = this.isSvg ? 'This SVG has errors and cannot be rendered.' : 'This image could not be decoded.';
        this.changed();
    };

    protected override onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    protected override onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.resizeObserver = new ResizeObserver(() => {
            if (this.fitMode) {
                this.applyFit();
                this.changed();
            }
        });
        this.resizeObserver.observe(this.node);
        this.addEventListener(this.node, 'keydown', event => this.onKeyDown(event));
    }

    protected override onBeforeDetach(msg: Message): void {
        this.resizeObserver?.disconnect();
        super.onBeforeDetach(msg);
    }

    protected onKeyDown(event: KeyboardEvent): void {
        if (event.ctrlKey || event.metaKey || event.altKey || (event.target as HTMLElement).closest('button')) {
            return;
        }
        if (event.key === '+' || event.key === '=') {
            this.zoomBy(1);
        } else if (event.key === '-') {
            this.zoomBy(-1);
        } else if (event.key === '0') {
            this.actualSize();
        } else {
            return;
        }
        event.preventDefault();
    }

    protected onWheel = (event: React.WheelEvent): void => {
        if (event.ctrlKey || event.metaKey) {
            this.zoomBy(event.deltaY < 0 ? 1 : -1);
        }
    };

    protected render(): React.ReactNode {
        const width = Math.round(this.natural.width * this.zoom);
        const height = Math.round(this.natural.height * this.zoom);
        return <div className='ingot-image-preview-root'>
            <div className='ingot-image-toolbar' role='toolbar' aria-label='Image preview'>
                {this.isSvg && <div className='ingot-image-modes' role='tablist' aria-label='SVG view'>
                    {SVG_MODES.map(mode => <button key={mode} type='button' role='tab' id={`ingot-image-mode-${mode}`} aria-selected={mode === 'preview'}
                        className={`ingot-image-mode${mode === 'preview' ? ' selected' : ''}`} onClick={() => this.onModeEmitter.fire(mode)}>{SVG_MODE_LABELS[mode]}</button>)}
                </div>}
                <span className='ingot-flex' />
                <button type='button' className='ingot-image-tool' id='ingot-image-zoom-out' title='Zoom out (-)' onClick={() => this.zoomBy(-1)}><span className='codicon codicon-zoom-out' /></button>
                <span className='ingot-image-zoom' id='ingot-image-zoom'>{formatZoom(this.zoom)}</span>
                <button type='button' className='ingot-image-tool' id='ingot-image-zoom-in' title='Zoom in (+)' onClick={() => this.zoomBy(1)}><span className='codicon codicon-zoom-in' /></button>
                <button type='button' className={`ingot-image-tool ingot-image-text${this.fitMode ? ' selected' : ''}`} id='ingot-image-fit' title='Fit to window' onClick={() => this.fitToWindow()}>Fit</button>
                <button type='button' className={`ingot-image-tool ingot-image-text${!this.fitMode && this.zoom === 1 ? ' selected' : ''}`} id='ingot-image-actual' title='Actual size (0)' onClick={() => this.actualSize()}>100%</button>
            </div>
            <div className='ingot-image-viewport' ref={el => { this.viewport = el; }} onWheel={this.onWheel}>
                {this.error && <div className='ingot-image-error' id='ingot-image-error'><span className='codicon codicon-warning' /> {this.error}</div>}
                {this.src && <div className='ingot-image-canvas' style={this.natural.width ? { width, height } : undefined}>
                    <img src={this.src} alt={this.uri.path.base} draggable={false} onLoad={this.onLoaded} onError={this.onBroken}
                        style={this.natural.width ? { width, height } : { visibility: 'hidden' }} />
                </div>}
            </div>
        </div>;
    }
}
