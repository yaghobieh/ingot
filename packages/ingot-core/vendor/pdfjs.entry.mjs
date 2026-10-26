// IDEA-146: one classic script with pdf.js and its viewer (pages, text layer, find), loaded on demand by the PDF viewer.
// ES module order guarantees pdfjs-global runs before pdf_viewer reads the global.
import './pdfjs-global.mjs';
import * as pdfjsViewer from 'pdfjs-dist/web/pdf_viewer.mjs';

globalThis.pdfjsViewer = pdfjsViewer;
