// IDEA-146: third-party viewers that load on demand instead of growing the main bundle. Both application builds
// (browser and Electron) call these from their esbuild.mjs; the files land in lib/frontend/vendor.
// The Electron frontend runs from file://, so everything is a classic script or worker, never an ES module.
import { cpSync, existsSync, mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
/** The installed package folder; walks up node_modules like Node does (both packages restrict deep requires). */
const packageDir = name => {
    for (let dir = here; ; dir = path.dirname(dir)) {
        const candidate = path.join(dir, 'node_modules', name);
        if (existsSync(path.join(candidate, 'package.json'))) {
            return candidate;
        }
        if (path.dirname(dir) === dir) {
            throw new Error(`${name} is not installed`);
        }
    }
};

/** Extra esbuild entry points, bundled with the same options as the frontend. */
export function vendorEntryPoints() {
    return {
        'vendor/pdfjs/pdf': path.join(here, 'pdfjs.entry.mjs'),
        'vendor/pdfjs/pdf.worker': path.join(packageDir('pdfjs-dist'), 'build', 'pdf.worker.mjs')
    };
}

/** Copies prebuilt files (mermaid, the pdf.js stylesheet, fonts, character maps, decoders) and their licenses. */
export function copyVendorAssets(frontendDir) {
    const pdfjs = packageDir('pdfjs-dist');
    const mermaid = packageDir('mermaid');
    const copies = [
        [path.join(mermaid, 'dist', 'mermaid.min.js'), 'mermaid/mermaid.min.js'],
        [path.join(mermaid, 'LICENSE'), 'mermaid/LICENSE'],
        [path.join(pdfjs, 'web', 'pdf_viewer.css'), 'pdfjs/pdf_viewer.css'],
        [path.join(pdfjs, 'web', 'images'), 'pdfjs/images'],
        [path.join(pdfjs, 'cmaps'), 'pdfjs/cmaps'],
        [path.join(pdfjs, 'standard_fonts'), 'pdfjs/standard_fonts'],
        [path.join(pdfjs, 'wasm'), 'pdfjs/wasm'],
        [path.join(pdfjs, 'iccs'), 'pdfjs/iccs'],
        [path.join(pdfjs, 'LICENSE'), 'pdfjs/LICENSE']
    ];
    for (const [from, to] of copies) {
        if (!existsSync(from)) {
            continue;
        }
        const target = path.join(frontendDir, 'vendor', to);
        mkdirSync(path.dirname(target), { recursive: true });
        cpSync(from, target, { recursive: true, filter: source => !source.endsWith('.map') });
    }
}
