import { VENDOR_PATHS } from '../../common/preview/document-preview.consts';

/**
 * IDEA-146: loads the on-demand viewers shipped in the frontend's `vendor` folder. Classic scripts only: the desktop
 * app runs from file://, where ES modules and module workers are not reliable.
 */
export const vendorUrl = (path: string): string => new URL(path, document.baseURI).toString();

const scripts = new Map<string, Promise<void>>();

export const loadScript = (path: string): Promise<void> => {
    let loading = scripts.get(path);
    if (!loading) {
        loading = new Promise<void>((resolve, reject) => {
            const script = document.createElement('script');
            script.src = vendorUrl(path);
            script.async = true;
            script.onload = () => resolve();
            script.onerror = () => {
                scripts.delete(path);
                script.remove();
                reject(new Error(`Could not load ${path}`));
            };
            document.head.appendChild(script);
        });
        scripts.set(path, loading);
    }
    return loading;
};

export const loadStylesheet = (path: string): void => {
    const href = vendorUrl(path);
    if (!document.head.querySelector(`link[data-ingot-vendor="${path}"]`)) {
        const link = document.createElement('link');
        link.rel = 'stylesheet';
        link.href = href;
        link.dataset.ingotVendor = path;
        document.head.appendChild(link);
    }
};

/** The parts of mermaid the preview uses. */
export interface MermaidApi {
    initialize(config: Record<string, unknown>): void;
    render(id: string, source: string): Promise<{ svg: string }>;
}

export const loadMermaid = async (): Promise<MermaidApi> => {
    await loadScript(VENDOR_PATHS.mermaid);
    const mermaid = (globalThis as { mermaid?: MermaidApi }).mermaid;
    if (!mermaid) {
        throw new Error('Mermaid did not load');
    }
    return mermaid;
};

/* The parts of pdf.js the viewer uses (the library ships ES module typings, which this CommonJS package cannot import). */
export interface PdfDocument {
    readonly numPages: number;
    destroy(): Promise<void>;
}
export interface PdfEventBus {
    on(name: string, listener: (event: Record<string, unknown>) => void): void;
    off(name: string, listener: (event: Record<string, unknown>) => void): void;
    dispatch(name: string, data: Record<string, unknown>): void;
}
export interface PdfViewer {
    currentPageNumber: number;
    currentScale: number;
    currentScaleValue: string;
    readonly pagesCount: number;
    setDocument(doc: PdfDocument | null): void;
    cleanup(): void;
    update(): void;
}
export interface PdfLinkService {
    setViewer(viewer: PdfViewer): void;
    setDocument(doc: PdfDocument | null, baseUrl: string | null): void;
}
export interface PdfJsLib {
    GlobalWorkerOptions: { workerPort: Worker | null; workerSrc: string };
    getDocument(params: Record<string, unknown>): { promise: Promise<PdfDocument>; destroy(): Promise<void> };
    AnnotationMode: { ENABLE: number };
}
export interface PdfJsViewer {
    EventBus: new () => PdfEventBus;
    PDFLinkService: new (options: { eventBus: PdfEventBus }) => PdfLinkService;
    PDFFindController: new (options: { eventBus: PdfEventBus; linkService: PdfLinkService }) => unknown;
    PDFViewer: new (options: Record<string, unknown>) => PdfViewer;
    FindState: { FOUND: number; NOT_FOUND: number; WRAPPED: number; PENDING: number };
}
export interface PdfJs {
    readonly lib: PdfJsLib;
    readonly viewer: PdfJsViewer;
}

let pdfjs: Promise<PdfJs> | undefined;

export const loadPdfJs = (): Promise<PdfJs> => {
    pdfjs ??= (async () => {
        loadStylesheet(VENDOR_PATHS.pdfCss);
        await loadScript(VENDOR_PATHS.pdfjs);
        const { pdfjsLib: lib, pdfjsViewer: viewer } = globalThis as { pdfjsLib?: PdfJsLib; pdfjsViewer?: PdfJsViewer };
        if (!lib || !viewer) {
            throw new Error('pdf.js did not load');
        }
        // One classic worker shared by every open PDF.
        lib.GlobalWorkerOptions.workerPort ??= new Worker(vendorUrl(VENDOR_PATHS.pdfWorker));
        return { lib, viewer };
    })().catch(error => {
        pdfjs = undefined;
        throw error;
    });
    return pdfjs;
};

/** Document options pointing pdf.js at the fonts, character maps and decoders shipped next to it. */
export const pdfAssetOptions = (): Record<string, unknown> => ({
    cMapUrl: vendorUrl(VENDOR_PATHS.pdfCmaps),
    cMapPacked: true,
    standardFontDataUrl: vendorUrl(VENDOR_PATHS.pdfFonts),
    wasmUrl: vendorUrl(VENDOR_PATHS.pdfWasm),
    iccUrl: vendorUrl(VENDOR_PATHS.pdfIccs),
    isEvalSupported: false
});
