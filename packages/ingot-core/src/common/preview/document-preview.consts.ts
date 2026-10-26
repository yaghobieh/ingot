/** IDEA-146: Markdown preview (Code / Preview / Side by side) and the built-in PDF viewer. */
export const MARKDOWN_PREVIEW_WIDGET_ID = 'ingot-markdown-preview';
export const PDF_VIEWER_WIDGET_ID = 'ingot-pdf-viewer';
export const MARKDOWN_EXTENSIONS = ['md', 'markdown', 'mdown', 'mkd', 'mdx'] as const;
export const MARKDOWN_MODES = ['code', 'preview', 'split'] as const;
export const MARKDOWN_MODE_CONTEXT = 'ingotMarkdownMode';
/** Typing pauses this long before the preview re-renders. */
export const MARKDOWN_RENDER_DELAY_MS = 120;
/** Programmatic scrolls of one side are ignored by the other side for this long (no ping-pong). */
export const SCROLL_SYNC_LOCK_MS = 120;
/** Preview images bigger than this are left as a broken link instead of stalling the preview. */
export const MAX_MARKDOWN_IMAGE_BYTES = 20_000_000;
export const MARKDOWN_COMMANDS = {
    code: { id: 'ingot.markdown.mode.code', label: 'Markdown: Code Only', category: 'Ingot', iconClass: 'codicon codicon-code' },
    preview: { id: 'ingot.markdown.mode.preview', label: 'Markdown: Preview Only', category: 'Ingot', iconClass: 'codicon codicon-open-preview' },
    split: { id: 'ingot.markdown.mode.split', label: 'Markdown: Side by Side', category: 'Ingot', iconClass: 'codicon codicon-split-horizontal' }
} as const;
export const MARKDOWN_MODE_TOOLTIPS = { code: 'Code only', preview: 'Preview only', split: 'Side by side' } as const;

export const PDF_STATUS_ID = 'ingot-pdf-info';
export const MIN_PDF_SCALE = 0.25;
export const MAX_PDF_SCALE = 5;
export const PDF_ZOOM_STEPS = [0.25, 0.5, 0.75, 1, 1.25, 1.5, 2, 3, 4, 5] as const;
/** Named zoom values pdf.js understands next to plain numbers. */
export const PDF_ZOOM_PRESETS = [
    { value: 'auto', label: 'Automatic' },
    { value: 'page-fit', label: 'Page Fit' },
    { value: 'page-width', label: 'Page Width' }
] as const;
export const PDF_FIND_DELAY_MS = 200;
/** PDFs bigger than this are not opened (the whole file is read into memory). */
export const MAX_PDF_BYTES = 200_000_000;
export const PDF_COMMANDS = {
    find: { id: 'ingot.pdf.find', label: 'PDF: Find', category: 'Ingot' },
    zoomIn: { id: 'ingot.pdf.zoomIn', label: 'PDF: Zoom In', category: 'Ingot' },
    zoomOut: { id: 'ingot.pdf.zoomOut', label: 'PDF: Zoom Out', category: 'Ingot' }
} as const;
/** Paths under the frontend's `vendor` folder (see packages/ingot-core/vendor/vendor-assets.mjs). */
export const VENDOR_PATHS = {
    pdfjs: 'vendor/pdfjs/pdf.js',
    pdfWorker: 'vendor/pdfjs/pdf.worker.js',
    pdfCss: 'vendor/pdfjs/pdf_viewer.css',
    pdfCmaps: 'vendor/pdfjs/cmaps/',
    pdfFonts: 'vendor/pdfjs/standard_fonts/',
    pdfWasm: 'vendor/pdfjs/wasm/',
    pdfIccs: 'vendor/pdfjs/iccs/',
    mermaid: 'vendor/mermaid/mermaid.min.js'
} as const;
