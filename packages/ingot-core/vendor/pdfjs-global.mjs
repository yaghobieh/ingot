// IDEA-146: pdf.js core, exposed as a global because its viewer module reads `globalThis.pdfjsLib` when it loads.
import * as pdfjsLib from 'pdfjs-dist/build/pdf.mjs';

globalThis.pdfjsLib = pdfjsLib;
