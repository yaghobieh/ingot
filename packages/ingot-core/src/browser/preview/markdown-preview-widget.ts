import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { BaseWidget, OpenerService, open, type Message, type NavigatableWidget } from '@theia/core/lib/browser';
import type { Disposable } from '@theia/core/lib/common/disposable';
import { Emitter } from '@theia/core/lib/common/event';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { MonacoTextModelService } from '@theia/monaco/lib/browser/monaco-text-model-service';
import type { MonacoEditorModel } from '@theia/monaco/lib/browser/monaco-editor-model';
import { MARKDOWN_PREVIEW_WIDGET_ID, MARKDOWN_RENDER_DELAY_MS, MAX_MARKDOWN_IMAGE_BYTES, SCROLL_SYNC_LOCK_MS } from '../../common/preview/document-preview.consts';
import { isWorkspaceTarget, lineForTop, normalizeAnchors, topForLine, type LineAnchor } from '../../common/preview/document-preview.utils';
import { imageMimeType, isImagePath } from '../../common/preview/image-preview.utils';
import { DOC_ID_PREFIX, MarkdownDocumentRenderer } from './markdown-document-renderer';
import { loadMermaid } from './vendor-loader';

export const MarkdownPreviewUri = Symbol('MarkdownPreviewUri');

/**
 * IDEA-146: rendered Markdown next to (or instead of) its editor. It renders the live text model, so it follows
 * typing before a save, and reports the source line at its top so the editor can scroll along (and vice versa).
 */
@injectable()
export class MarkdownPreviewWidget extends BaseWidget implements NavigatableWidget {

    @inject(MarkdownPreviewUri) protected readonly uri: URI;
    @inject(MonacoTextModelService) protected readonly models: MonacoTextModelService;
    @inject(FileService) protected readonly files: FileService;
    @inject(OpenerService) protected readonly openers: OpenerService;
    @inject(WindowService) protected readonly windows: WindowService;

    protected readonly scroller = document.createElement('div');
    protected readonly body = document.createElement('div');
    protected readonly renderer = new MarkdownDocumentRenderer(() => this.scheduleRender(0));
    protected model: MonacoEditorModel | undefined;
    protected renderTimer: number | undefined;
    protected anchors: LineAnchor[] | undefined;
    protected lineCount = 1;
    protected ignoreScrollUntil = 0;
    protected readonly images = new Map<string, Promise<string | undefined>>();
    protected readonly mermaidSvgs = new Map<string, string>();
    protected mermaidTheme = '';
    protected readonly onScrollEmitter = new Emitter<number>();
    /** The (fractional, 0-based) source line now at the top, when the user scrolls the preview. */
    readonly onDidScrollToLine = this.onScrollEmitter.event;
    protected readonly onRenderEmitter = new Emitter<void>();
    readonly onDidRender = this.onRenderEmitter.event;

    @postConstruct()
    protected init(): void {
        this.id = `${MARKDOWN_PREVIEW_WIDGET_ID}:${this.uri.toString()}`;
        this.title.label = `Preview ${this.uri.path.base}`;
        this.title.caption = `Preview of ${this.uri.path.fsPath()}`;
        this.title.closable = true;
        this.title.iconClass = 'codicon codicon-open-preview';
        this.addClass('ingot-markdown-preview');
        this.node.tabIndex = 0;
        this.scroller.className = 'ingot-mdp-scroll';
        this.body.className = 'ingot-mdp-body';
        this.scroller.appendChild(this.body);
        this.node.appendChild(this.scroller);
        this.scroller.addEventListener('scroll', () => this.onUserScroll(), { passive: true });
        this.body.addEventListener('click', event => this.onClick(event));
        this.toDispose.pushAll([this.onScrollEmitter, this.onRenderEmitter, { dispose: () => window.clearTimeout(this.renderTimer) }]);
        this.toDispose.push(this.files.onDidFilesChange(event => {
            if (event.changes.some(change => isImagePath(change.resource.path.base))) {
                this.images.clear();
                this.scheduleRender(0);
            }
        }));
        void this.attachModel();
    }

    getResourceUri(): URI {
        return this.uri;
    }

    createMoveToUri(resourceUri: URI): URI | undefined {
        return resourceUri;
    }

    protected async attachModel(): Promise<void> {
        try {
            const reference = await this.models.createModelReference(this.uri);
            if (this.isDisposed) {
                reference.dispose();
                return;
            }
            this.model = reference.object;
            this.toDispose.push(reference);
            this.toDispose.push(this.model.textEditorModel.onDidChangeContent(() => this.scheduleRender(MARKDOWN_RENDER_DELAY_MS)));
            this.render();
        } catch (error) {
            this.body.textContent = `Could not open ${this.uri.path.base}: ${error instanceof Error ? error.message : String(error)}`;
        }
    }

    protected scheduleRender(delay: number): void {
        window.clearTimeout(this.renderTimer);
        this.renderTimer = window.setTimeout(() => this.render(), delay);
    }

    protected render(): void {
        if (!this.model || this.isDisposed) {
            return;
        }
        const text = this.model.textEditorModel.getValue();
        this.lineCount = Math.max(1, this.model.textEditorModel.getLineCount());
        const top = this.scroller.scrollTop;
        this.body.replaceChildren(...this.renderer.render(text));
        this.anchors = undefined;
        this.ignoreScrollUntil = Date.now() + SCROLL_SYNC_LOCK_MS;
        this.scroller.scrollTop = top;
        void this.loadImages();
        void this.renderMermaid();
        this.onRenderEmitter.fire();
    }

    protected async loadImages(): Promise<void> {
        for (const img of Array.from(this.body.querySelectorAll<HTMLImageElement>('img[data-ingot-src]'))) {
            const target = img.dataset.ingotSrc ?? '';
            const resource = this.resolve(target);
            let url = this.images.get(resource.toString());
            if (!url) {
                url = this.readImage(resource);
                this.images.set(resource.toString(), url);
            }
            const src = await url;
            if (src) {
                img.src = src;
                img.addEventListener('load', () => { this.anchors = undefined; }, { once: true });
            } else {
                img.classList.add('ingot-mdp-missing');
                img.alt = img.alt || target;
            }
        }
    }

    protected async readImage(resource: URI): Promise<string | undefined> {
        try {
            const stat = await this.files.resolve(resource);
            if (stat.isDirectory || (stat.size ?? 0) > MAX_MARKDOWN_IMAGE_BYTES) {
                return undefined;
            }
            const content = await this.files.readFile(resource);
            const url = URL.createObjectURL(new Blob([content.value.buffer as BlobPart], { type: imageMimeType(resource.path.base) || 'application/octet-stream' }));
            this.toDispose.push({ dispose: () => URL.revokeObjectURL(url) });
            return url;
        } catch {
            return undefined;
        }
    }

    protected async renderMermaid(): Promise<void> {
        const blocks = Array.from(this.body.querySelectorAll<HTMLElement>('.ingot-mdp-mermaid[data-source]'));
        if (!blocks.length) {
            return;
        }
        const dark = document.body.classList.contains('theia-dark') || document.body.classList.contains('theia-hc');
        const theme = dark ? 'dark' : 'default';
        try {
            const mermaid = await loadMermaid();
            if (theme !== this.mermaidTheme) {
                mermaid.initialize({ startOnLoad: false, securityLevel: 'strict', theme, fontFamily: 'inherit' });
                this.mermaidTheme = theme;
                this.mermaidSvgs.clear();
            }
            let n = 0;
            for (const block of blocks) {
                const source = decodeURIComponent(block.dataset.source ?? '');
                let svg = this.mermaidSvgs.get(source);
                if (!svg) {
                    try {
                        svg = (await mermaid.render(`ingot-mermaid-${Date.now()}-${n++}`, source)).svg;
                        this.mermaidSvgs.set(source, svg);
                    } catch (error) {
                        block.classList.add('ingot-mdp-mermaid-error');
                        block.title = error instanceof Error ? error.message : String(error);
                        continue;
                    }
                }
                if (block.isConnected) {
                    // Mermaid output with securityLevel "strict" is sanitized by mermaid itself.
                    block.innerHTML = svg;
                    block.classList.add('rendered');
                }
            }
            this.anchors = undefined;
        } catch (error) {
            for (const block of blocks) {
                block.title = error instanceof Error ? error.message : String(error);
            }
        }
    }

    protected resolve(target: string): URI {
        const path = decodeURI(target.split(/[?#]/)[0]);
        return path.startsWith('/') ? this.uri.withPath(path) : this.uri.parent.resolve(path);
    }

    protected onClick(event: MouseEvent): void {
        const link = (event.target as HTMLElement).closest('a');
        const href = link?.getAttribute('href');
        if (!link || !href) {
            return;
        }
        event.preventDefault();
        if (href.startsWith('#')) {
            this.body.querySelector(`[id="${CSS.escape(DOC_ID_PREFIX + decodeURIComponent(href.slice(1)))}"]`)?.scrollIntoView({ block: 'start' });
        } else if (isWorkspaceTarget(href)) {
            void open(this.openers, this.resolve(href));
        } else if (/^(https?|mailto):/i.test(href)) {
            this.windows.openNewWindow(href, { external: true });
        }
    }

    /** Scrolls so a (fractional, 0-based) source line is at the top, without echoing it back. */
    scrollToLine(line: number): void {
        const anchors = this.lineAnchors();
        this.ignoreScrollUntil = Date.now() + SCROLL_SYNC_LOCK_MS;
        this.scroller.scrollTop = topForLine(anchors, line, this.scroller.scrollHeight, this.lineCount);
    }

    protected onUserScroll(): void {
        if (Date.now() < this.ignoreScrollUntil) {
            return;
        }
        this.onScrollEmitter.fire(lineForTop(this.lineAnchors(), this.scroller.scrollTop, this.scroller.scrollHeight, this.lineCount));
    }

    protected lineAnchors(): LineAnchor[] {
        if (!this.anchors) {
            const origin = this.body.getBoundingClientRect().top;
            this.anchors = normalizeAnchors(Array.from(this.body.querySelectorAll<HTMLElement>('[data-line]')).map(element => ({
                line: Number(element.dataset.line),
                top: element.getBoundingClientRect().top - origin
            })).filter(anchor => Number.isFinite(anchor.line)));
        }
        return this.anchors;
    }

    /** Re-render mermaid diagrams in the new theme colours. */
    refreshTheme(): void {
        if (this.body.querySelector('.ingot-mdp-mermaid')) {
            this.render();
        }
    }

    protected onResize(msg: Parameters<BaseWidget['onResize']>[0]): void {
        super.onResize(msg);
        this.anchors = undefined;
    }

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    trackDisposable(disposable: Disposable): void {
        this.toDispose.push(disposable);
    }
}
