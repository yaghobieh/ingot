import { inject, injectable, postConstruct } from '@theia/core/shared/inversify';
import { BaseWidget, codicon, type Message, type NavigatableWidget } from '@theia/core/lib/browser';
import { Emitter } from '@theia/core/lib/common/event';
import URI from '@theia/core/lib/common/uri';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { MAX_PDF_BYTES, PDF_FIND_DELAY_MS, PDF_VIEWER_WIDGET_ID, PDF_ZOOM_PRESETS, PDF_ZOOM_STEPS } from '../../common/preview/document-preview.consts';
import { formatBytes } from '../../common/preview/image-preview.utils';
import { formatMatches, formatScale, nextPdfScale, parsePageInput } from '../../common/preview/document-preview.utils';
import { loadPdfJs, pdfAssetOptions, type PdfDocument, type PdfEventBus, type PdfJs, type PdfLinkService, type PdfViewer } from './vendor-loader';

export const PdfViewerUri = Symbol('PdfViewerUri');

export interface PdfInfo {
    readonly page: number;
    readonly pages: number;
    readonly scale: number;
}

const button = (id: string, icon: string, title: string): HTMLButtonElement => {
    const element = document.createElement('button');
    element.type = 'button';
    element.id = id;
    element.className = `ingot-pdf-tool ${codicon(icon)}`;
    element.title = title;
    element.setAttribute('aria-label', title);
    return element;
};

/**
 * IDEA-146: built-in PDF viewer (pdf.js) - continuous pages with selectable text, page navigation, zoom (buttons,
 * presets, Ctrl/Cmd + wheel) and search with highlighted matches.
 */
@injectable()
export class PdfViewerWidget extends BaseWidget implements NavigatableWidget {

    @inject(PdfViewerUri) protected readonly uri: URI;
    @inject(FileService) protected readonly files: FileService;

    protected readonly toolbar = document.createElement('div');
    protected readonly container = document.createElement('div');
    protected readonly pagesNode = document.createElement('div');
    protected readonly pageInput = document.createElement('input');
    protected readonly pageCount = document.createElement('span');
    protected readonly zoomSelect = document.createElement('select');
    protected readonly searchInput = document.createElement('input');
    protected readonly matches = document.createElement('span');
    protected readonly message = document.createElement('div');
    protected pdfjs: PdfJs | undefined;
    protected viewer: PdfViewer | undefined;
    protected eventBus: PdfEventBus | undefined;
    protected linkService: PdfLinkService | undefined;
    protected document: PdfDocument | undefined;
    protected findTimer: number | undefined;
    protected loading: Promise<void> | undefined;
    protected bytes = 0;
    protected readonly onInfoEmitter = new Emitter<void>();
    readonly onDidChangeInfo = this.onInfoEmitter.event;

    @postConstruct()
    protected init(): void {
        this.id = `${PDF_VIEWER_WIDGET_ID}:${this.uri.toString()}`;
        this.title.label = this.uri.path.base;
        this.title.caption = this.uri.path.fsPath();
        this.title.closable = true;
        this.title.iconClass = codicon('file-pdf');
        this.addClass('ingot-pdf-viewer');
        this.node.tabIndex = 0;
        this.buildToolbar();
        this.container.className = 'ingot-pdf-container';
        this.pagesNode.className = 'pdfViewer';
        this.container.appendChild(this.pagesNode);
        this.message.className = 'ingot-pdf-message';
        this.message.hidden = true;
        const body = document.createElement('div');
        body.className = 'ingot-pdf-body';
        body.append(this.container, this.message);
        this.node.append(this.toolbar, body);
        this.node.addEventListener('keydown', event => this.onKeyDown(event));
        this.container.addEventListener('wheel', event => this.onWheel(event), { passive: false });
        this.toDispose.pushAll([this.onInfoEmitter, { dispose: () => this.closeDocument() }]);
        this.toDispose.push(this.files.onDidFilesChange(event => {
            if (event.contains(this.uri) && this.isAttached) {
                this.loading = this.load();
            }
        }));
    }

    getResourceUri(): URI {
        return this.uri;
    }

    createMoveToUri(resourceUri: URI): URI | undefined {
        return resourceUri;
    }

    get info(): PdfInfo | undefined {
        return this.viewer && this.document ? { page: this.viewer.currentPageNumber, pages: this.document.numPages, scale: this.viewer.currentScale } : undefined;
    }

    get fileSize(): string {
        return formatBytes(this.bytes);
    }

    protected buildToolbar(): void {
        this.toolbar.className = 'ingot-pdf-toolbar';
        const prev = button('ingot-pdf-prev', 'chevron-up', 'Previous page');
        const next = button('ingot-pdf-next', 'chevron-down', 'Next page');
        prev.onclick = () => this.goToPage((this.viewer?.currentPageNumber ?? 1) - 1);
        next.onclick = () => this.goToPage((this.viewer?.currentPageNumber ?? 1) + 1);
        this.pageInput.id = 'ingot-pdf-page';
        this.pageInput.className = 'ingot-pdf-page theia-input';
        this.pageInput.setAttribute('aria-label', 'Page number');
        this.pageInput.onchange = () => this.goToPage(parsePageInput(this.pageInput.value, this.document?.numPages ?? 0));
        this.pageInput.onkeydown = event => {
            if (event.key === 'Enter') {
                this.goToPage(parsePageInput(this.pageInput.value, this.document?.numPages ?? 0));
            }
        };
        this.pageCount.id = 'ingot-pdf-pages';
        this.pageCount.className = 'ingot-pdf-count';

        const zoomOut = button('ingot-pdf-zoom-out', 'zoom-out', 'Zoom out');
        const zoomIn = button('ingot-pdf-zoom-in', 'zoom-in', 'Zoom in');
        zoomOut.onclick = () => this.zoomBy(-1);
        zoomIn.onclick = () => this.zoomBy(1);
        this.zoomSelect.id = 'ingot-pdf-zoom';
        this.zoomSelect.className = 'ingot-pdf-zoom theia-select';
        this.zoomSelect.setAttribute('aria-label', 'Zoom');
        this.fillZoomOptions();
        this.zoomSelect.onchange = () => this.setScaleValue(this.zoomSelect.value);

        const search = document.createElement('div');
        search.className = 'ingot-pdf-search';
        const searchIcon = document.createElement('span');
        searchIcon.className = codicon('search');
        this.searchInput.id = 'ingot-pdf-search';
        this.searchInput.className = 'theia-input';
        this.searchInput.placeholder = 'Find in document';
        this.searchInput.setAttribute('aria-label', 'Find in document');
        this.searchInput.oninput = () => {
            window.clearTimeout(this.findTimer);
            this.findTimer = window.setTimeout(() => this.find(false, false), PDF_FIND_DELAY_MS);
        };
        this.searchInput.onkeydown = event => {
            if (event.key === 'Enter') {
                event.preventDefault();
                this.find(true, event.shiftKey);
            } else if (event.key === 'Escape') {
                this.searchInput.value = '';
                this.find(false, false);
                this.node.focus();
            }
        };
        this.matches.id = 'ingot-pdf-matches';
        this.matches.className = 'ingot-pdf-count';
        const findPrev = button('ingot-pdf-find-prev', 'arrow-up', 'Previous match (Shift+Enter)');
        const findNext = button('ingot-pdf-find-next', 'arrow-down', 'Next match (Enter)');
        findPrev.onclick = () => this.find(true, true);
        findNext.onclick = () => this.find(true, false);
        search.append(searchIcon, this.searchInput, this.matches, findPrev, findNext);

        const sep = () => Object.assign(document.createElement('span'), { className: 'ingot-pdf-sep' });
        const spacer = Object.assign(document.createElement('span'), { className: 'ingot-pdf-spacer' });
        this.toolbar.append(prev, next, this.pageInput, this.pageCount, sep(), zoomOut, this.zoomSelect, zoomIn, spacer, search);
    }

    protected fillZoomOptions(custom?: number): void {
        const options: Array<[string, string]> = PDF_ZOOM_PRESETS.map(p => [p.value, p.label]);
        const steps: number[] = [...PDF_ZOOM_STEPS];
        if (custom !== undefined && !steps.some(step => Math.abs(step - custom) < 1e-3)) {
            steps.push(custom);
            steps.sort((a, b) => a - b);
        }
        options.push(...steps.map((step): [string, string] => [String(step), formatScale(step)]));
        this.zoomSelect.replaceChildren(...options.map(([value, label]) => Object.assign(document.createElement('option'), { value, textContent: label })));
    }

    protected onAfterAttach(msg: Message): void {
        super.onAfterAttach(msg);
        this.loading ??= this.load();
    }

    protected async load(): Promise<void> {
        this.showMessage('Loading…');
        try {
            this.pdfjs ??= await loadPdfJs();
            const stat = await this.files.resolve(this.uri);
            if ((stat.size ?? 0) > MAX_PDF_BYTES) {
                this.showMessage(`This PDF is too large to preview (${formatBytes(stat.size ?? 0)}).`, true);
                return;
            }
            const content = await this.files.readFile(this.uri);
            this.bytes = content.value.byteLength;
            this.ensureViewer();
            const previous = this.document;
            const keepPage = previous ? this.viewer!.currentPageNumber : 1;
            const doc = await this.pdfjs.lib.getDocument({ data: content.value.buffer.slice(), ...pdfAssetOptions() }).promise;
            if (this.isDisposed) {
                void doc.destroy();
                return;
            }
            this.document = doc;
            this.viewer!.setDocument(doc);
            this.linkService!.setDocument(doc, null);
            if (previous) {
                void previous.destroy();
                const restore = () => {
                    this.eventBus?.off('pagesinit', restore);
                    this.goToPage(keepPage);
                };
                this.eventBus!.on('pagesinit', restore);
            }
            this.showMessage(undefined);
        } catch (error) {
            const reason = error instanceof Error ? error.message : String(error);
            this.showMessage(`Could not open ${this.uri.path.base}: ${reason}`, true);
        }
    }

    protected ensureViewer(): void {
        if (this.viewer || !this.pdfjs) {
            return;
        }
        const { viewer: lib } = this.pdfjs;
        const eventBus = new lib.EventBus();
        const linkService = new lib.PDFLinkService({ eventBus });
        const findController = new lib.PDFFindController({ eventBus, linkService });
        const viewer = new lib.PDFViewer({
            container: this.container, viewer: this.pagesNode, eventBus, linkService, findController,
            textLayerMode: 1, annotationMode: this.pdfjs.lib.AnnotationMode.ENABLE, removePageBorders: false
        });
        linkService.setViewer(viewer);
        eventBus.on('pagesinit', () => {
            viewer.currentScaleValue = 'auto';
            this.refreshControls();
        });
        eventBus.on('pagechanging', () => this.refreshControls());
        eventBus.on('scalechanging', () => this.refreshControls());
        eventBus.on('pagesloaded', () => this.refreshControls());
        eventBus.on('updatefindmatchescount', event => this.showMatches(event.matchesCount as { current: number; total: number }));
        eventBus.on('updatefindcontrolstate', event => {
            this.searchInput.classList.toggle('not-found', event.state === lib.FindState.NOT_FOUND && !!this.searchInput.value);
            if (event.matchesCount) {
                this.showMatches(event.matchesCount as { current: number; total: number });
            }
        });
        this.viewer = viewer;
        this.eventBus = eventBus;
        this.linkService = linkService;
    }

    protected showMatches(count: { current: number; total: number } | undefined): void {
        this.matches.textContent = this.searchInput.value && count ? formatMatches(count.current, count.total) : '';
    }

    protected showMessage(text: string | undefined, error = false): void {
        this.message.hidden = !text;
        this.message.textContent = text ?? '';
        this.message.classList.toggle('error', error);
    }

    protected refreshControls(): void {
        const info = this.info;
        if (info) {
            if (document.activeElement !== this.pageInput) {
                this.pageInput.value = String(info.page);
            }
            this.pageCount.textContent = `of ${info.pages}`;
            const value = this.viewer!.currentScaleValue;
            const preset = PDF_ZOOM_PRESETS.some(p => p.value === value);
            const scale = Number(value);
            this.fillZoomOptions(preset ? undefined : info.scale);
            this.zoomSelect.value = preset ? value : String(Number.isFinite(scale) && PDF_ZOOM_STEPS.some(s => Math.abs(s - scale) < 1e-3) ? scale : info.scale);
        }
        this.onInfoEmitter.fire();
    }

    goToPage(page: number | undefined): void {
        if (this.viewer && this.document && page !== undefined) {
            this.viewer.currentPageNumber = Math.min(this.document.numPages, Math.max(1, page));
        }
    }

    zoomBy(direction: 1 | -1): void {
        if (this.viewer) {
            this.setScaleValue(String(nextPdfScale(this.viewer.currentScale, direction)));
        }
    }

    protected setScaleValue(value: string): void {
        if (this.viewer) {
            this.viewer.currentScaleValue = value;
        }
    }

    focusSearch(): void {
        this.searchInput.focus();
        this.searchInput.select();
    }

    protected find(again: boolean, previous: boolean): void {
        this.eventBus?.dispatch('find', {
            source: this, type: again ? 'again' : '', query: this.searchInput.value,
            caseSensitive: false, entireWord: false, highlightAll: true, findPrevious: previous, matchDiacritics: false
        });
        if (!this.searchInput.value) {
            this.matches.textContent = '';
            this.searchInput.classList.remove('not-found');
        }
    }

    protected onKeyDown(event: KeyboardEvent): void {
        const mod = event.ctrlKey || event.metaKey;
        if (mod && event.key.toLowerCase() === 'f') {
            event.preventDefault();
            event.stopPropagation();
            this.focusSearch();
        } else if (event.target === this.searchInput || event.target === this.pageInput || event.target === this.zoomSelect) {
            return;
        } else if (mod && (event.key === '=' || event.key === '+')) {
            event.preventDefault();
            this.zoomBy(1);
        } else if (mod && event.key === '-') {
            event.preventDefault();
            this.zoomBy(-1);
        } else if (mod && event.key === '0') {
            event.preventDefault();
            this.setScaleValue('auto');
        }
    }

    protected onWheel(event: WheelEvent): void {
        if (event.ctrlKey || event.metaKey) {
            event.preventDefault();
            this.zoomBy(event.deltaY < 0 ? 1 : -1);
        }
    }

    protected onResize(msg: Parameters<BaseWidget['onResize']>[0]): void {
        super.onResize(msg);
        const value = this.viewer?.currentScaleValue;
        if (value && PDF_ZOOM_PRESETS.some(p => p.value === value)) {
            this.viewer!.currentScaleValue = value;
        }
    }

    protected onActivateRequest(msg: Message): void {
        super.onActivateRequest(msg);
        this.node.focus();
    }

    protected closeDocument(): void {
        window.clearTimeout(this.findTimer);
        this.viewer?.setDocument(null);
        this.linkService?.setDocument(null, null);
        void this.document?.destroy();
        this.document = undefined;
    }
}
