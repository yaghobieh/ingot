import { inject, injectable } from '@theia/core/shared/inversify';
import { AbstractViewContribution } from '@theia/core/lib/browser';
import type { CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EnvVariablesServer } from '@theia/core/lib/common/env-variables';
import URI from '@theia/core/lib/common/uri';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog/file-dialog-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { PluginServer } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { validatePluginManifest } from '../../common/plugins/plugins.utils';
import { IngotPluginsWidget } from './ingot-plugins-widget';
import { PLUGINS_INSTALL_FOLDER_COMMAND, PLUGINS_OPEN_COMMAND, PLUGINS_WIDGET_ID, PLUGINS_WIDGET_LABEL } from './plugins.browser-consts';

const DEPLOYED_PLUGINS_DIR = 'deployedPlugins';

@injectable()
export class IngotPluginsContribution extends AbstractViewContribution<IngotPluginsWidget> {

    @inject(FileDialogService) protected readonly fileDialog: FileDialogService;
    @inject(FileService) protected readonly files: FileService;
    @inject(PluginServer) protected readonly pluginServer: PluginServer;
    @inject(EnvVariablesServer) protected readonly env: EnvVariablesServer;
    @inject(MessageService) protected readonly messages: MessageService;

    constructor() {
        super({ widgetId: PLUGINS_WIDGET_ID, widgetName: PLUGINS_WIDGET_LABEL, defaultWidgetOptions: { area: 'main' } });
    }

    override registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(PLUGINS_OPEN_COMMAND, { execute: () => this.openView({ activate: true, reveal: true }) });
        registry.registerCommand(PLUGINS_INSTALL_FOLDER_COMMAND, { execute: (folder?: unknown) => this.installFromFolder(typeof folder === 'string' ? new URI(folder) : undefined) });
    }

    /**
     * Developer flow: copies an unpacked VS Code extension / theme folder into the deployed plugins
     * directory (so it survives restarts) and deploys it right away.
     */
    async installFromFolder(given?: URI): Promise<void> {
        const folder = given ?? await this.fileDialog.showOpenDialog({ title: 'Install Plugin from Folder', canSelectFiles: false, canSelectFolders: true, openLabel: 'Install' });
        if (!folder) {
            return;
        }
        try {
            const manifest = await this.files.read(folder.resolve('package.json'));
            const { id, folder: name } = validatePluginManifest(manifest.value);
            const deployDir = new URI(await this.env.getConfigDirUri()).resolve(DEPLOYED_PLUGINS_DIR);
            const target = deployDir.resolve(name);
            await this.files.copy(folder, target, { overwrite: true });
            await this.pluginServer.install(deployDir.withScheme('local-dir').toString());
            this.messages.info(`Installed plugin ${id} from ${folder.path.base}.`);
        } catch (error) {
            this.messages.error(`Could not install plugin: ${error instanceof Error ? error.message : String(error)}`);
        }
    }
}
