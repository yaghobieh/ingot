import * as fs from 'fs';
import * as path from 'path';
import { inject, injectable } from '@theia/core/shared/inversify';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import { FileUri } from '@theia/core/lib/common/file-uri';
import { PluginIdentifiers, type PluginDeployerParticipant } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { PluginUninstallationManager } from '@theia/plugin-ext/lib/main/node/plugin-uninstallation-manager';
import { DEPLOYED_PLUGINS_DIR, parseJsonc, PLUGIN_MANIFEST_PATHS, usesUnsupportedApi } from '../common/import/editor-import';

interface PluginManifest { readonly publisher?: string; readonly name?: string; readonly version?: string; readonly enabledApiProposals?: unknown }

const readManifest = (folder: string): PluginManifest | undefined => {
    for (const relative of PLUGIN_MANIFEST_PATHS) {
        try {
            return parseJsonc(fs.readFileSync(path.join(folder, relative), 'utf8')) as PluginManifest;
        } catch {
            // Missing or unreadable: try the next layout.
        }
    }
    return undefined;
};

/** Unversioned ids (as Theia keys disabled plugins) of the plugins in `root` that need APIs Ingot cannot provide. */
export const findUnsupportedPlugins = (root: string): PluginIdentifiers.UnversionedId[] => {
    let folders: string[];
    try {
        folders = fs.readdirSync(root, { withFileTypes: true }).filter(e => e.isDirectory() || e.isSymbolicLink()).map(e => path.join(root, e.name));
    } catch {
        return [];
    }
    const ids = new Set<PluginIdentifiers.UnversionedId>();
    for (const folder of folders) {
        const manifest = readManifest(folder);
        if (manifest?.name && usesUnsupportedApi(manifest)) {
            ids.add(PluginIdentifiers.componentsToUnversionedId({ publisher: manifest.publisher, name: manifest.name, version: manifest.version ?? '' }));
        }
    }
    return [...ids];
};

/**
 * Plugins copied into deployedPlugins before the import skipped them (Remote - SSH, Dev Containers, WSL) fail on activation.
 * Before Theia deploys that folder, mark them disabled so they are never started.
 */
@injectable()
export class UnsupportedPluginsParticipant implements PluginDeployerParticipant {

    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;
    @inject(PluginUninstallationManager) protected readonly uninstallation: PluginUninstallationManager;

    async onWillStart(): Promise<void> {
        try {
            const root = path.join(FileUri.fsPath(await this.env.getConfigDirUri()), DEPLOYED_PLUGINS_DIR);
            const unsupported = findUnsupportedPlugins(root);
            if (unsupported.length && await this.uninstallation.markAsDisabled(...unsupported)) {
                console.info(`[ingot] Disabled plugins that need unsupported APIs: ${unsupported.join(', ')}`);
            }
        } catch (error) {
            console.warn(`[ingot] Could not check deployed plugins: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
