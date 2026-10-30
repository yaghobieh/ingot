/**
 * This file can be edited to adjust the ESBuild build process.
 * To reset, delete this file and rerun theia build again.
 */
import { browserOptions, watch } from './gen-esbuild.browser.mjs';
import { nodeOptions } from './gen-esbuild.node.mjs';

import esbuild from 'esbuild';
import { copyVendorAssets, vendorEntryPoints } from '../../packages/ingot-core/vendor/vendor-assets.mjs';

// IDEA-146: on-demand viewers (pdf.js, mermaid) for the Markdown and PDF previews.
Object.assign(browserOptions.entryPoints, vendorEntryPoints());
copyVendorAssets('lib/frontend');

// IDEA-286: monaco-vim imports `monaco-editor`; point it at Theia's Monaco so both share one editor instance.
browserOptions.alias = { ...browserOptions.alias, 'monaco-editor': '@theia/monaco-editor-core' };

const browserContext = await esbuild.context(browserOptions);
const nodeContext = await esbuild.context(nodeOptions);


if (watch) {
    await Promise.all([
        browserContext.watch(),
        nodeContext.watch(),
    ]);
} else {
    try {
        await browserContext.rebuild();
        await browserContext.dispose();
        await nodeContext.rebuild();
        await nodeContext.dispose();
    } catch {
        process.exit(1);
    }
}
