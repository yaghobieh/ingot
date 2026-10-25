/**
 * This file can be edited to adjust the ESBuild build process.
 * To reset, delete this file and rerun theia build again.
 */
import { browserOptions, watch } from './gen-esbuild.browser.mjs';
import { nodeOptions } from './gen-esbuild.node.mjs';
import { electronOptions } from './gen-esbuild.electron.mjs';
import esbuild from 'esbuild';
import { cpSync, existsSync } from 'node:fs';

// IDEA-108: the bundled main process looks for the Dock icon and launch frames in ./resources (packaged too).
const CORE_RESOURCES = '../../packages/ingot-core/resources';
if (existsSync(CORE_RESOURCES)) {
    cpSync(`${CORE_RESOURCES}/app-icon.png`, 'resources/app-icon.png');
    cpSync(`${CORE_RESOURCES}/dock-anim`, 'resources/dock-anim', { recursive: true });
}

const browserContext = await esbuild.context(browserOptions);
const nodeContext = await esbuild.context(nodeOptions);
const electronContext = await esbuild.context(electronOptions);

if (watch) {
    await Promise.all([
        browserContext.watch(),
        nodeContext.watch(),
        electronContext.watch(),
    ]);
} else {
    try {
        await browserContext.rebuild();
        await browserContext.dispose();
        await nodeContext.rebuild();
        await nodeContext.dispose();
        await electronContext.rebuild();
        await electronContext.dispose();
    } catch {
        process.exit(1);
    }
}
