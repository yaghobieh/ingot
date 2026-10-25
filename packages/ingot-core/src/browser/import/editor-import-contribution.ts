import { inject, injectable } from '@theia/core/shared/inversify';
import { CommonMenus, type FrontendApplicationContribution } from '@theia/core/lib/browser';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import type { CommandContribution, CommandRegistry, MenuContribution, MenuModelRegistry } from '@theia/core/lib/common';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PluginServer } from '@theia/plugin-ext/lib/common/plugin-protocol';
import { IMPORT_COMMAND, IMPORT_PROMPTED_KEY } from '../../common/import/editor-import';
import { EditorImportService, type ImportSource } from '../../common/import/editor-import.types';
import { EditorImportDialog, type ImportChoice, type ImportRowState } from './editor-import-dialog';

const PROMPT_IMPORT = 'Import…';
const PROMPT_LATER = 'Not now';

/** IDEA-107: "Import from Another Editor…" (command, menus) and a one-time first-run prompt. */
@injectable()
export class EditorImportContribution implements CommandContribution, MenuContribution, FrontendApplicationContribution {

    @inject(EditorImportService) protected readonly service: EditorImportService;
    @inject(PluginServer) protected readonly plugins: PluginServer;
    @inject(StorageService) protected readonly storage: StorageService;
    @inject(MessageService) protected readonly messages: MessageService;

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(IMPORT_COMMAND, { execute: () => this.open() });
    }

    registerMenus(menus: MenuModelRegistry): void {
        menus.registerMenuAction(CommonMenus.MANAGE_GENERAL, { commandId: IMPORT_COMMAND.id, label: IMPORT_COMMAND.label, order: 'b1' });
        menus.registerMenuAction(CommonMenus.FILE_SETTINGS_SUBMENU_OPEN, { commandId: IMPORT_COMMAND.id, label: IMPORT_COMMAND.label, order: 'z1' });
    }

    async onDidInitializeLayout(): Promise<void> {
        if (await this.storage.getData<boolean>(IMPORT_PROMPTED_KEY, false)) {
            return;
        }
        const sources = await this.service.detect().catch(() => []);
        const count = new Set(sources.flatMap(s => s.extensions.map(e => e.id))).size;
        if (!count) {
            return;
        }
        void this.messages.info(`Found ${count} extension${count === 1 ? '' : 's'} in another editor's folder. Import them into Ingot?`, PROMPT_IMPORT, PROMPT_LATER).then(answer => {
            void this.storage.setData(IMPORT_PROMPTED_KEY, true);
            if (answer === PROMPT_IMPORT) {
                void this.open(sources);
            }
        });
    }

    async open(known?: ImportSource[]): Promise<void> {
        const sources = known ?? await this.service.detect();
        await new EditorImportDialog(sources, (choice, report) => this.run(choice, report)).open();
    }

    protected async run(choice: ImportChoice, report: (id: string, state: ImportRowState) => void): Promise<string> {
        let installed = 0;
        let failed = 0;
        for (const extension of choice.extensions) {
            report(extension.id, { state: 'working' });
            try {
                const prepared = await this.service.prepare(extension);
                await this.plugins.install(prepared.entry);
                installed++;
                report(extension.id, { state: 'done', via: prepared.via });
            } catch (error) {
                failed++;
                report(extension.id, { state: 'failed', message: error instanceof Error ? error.message : String(error) });
            }
        }
        const parts = [`${installed} extension${installed === 1 ? '' : 's'} imported${failed ? `, ${failed} failed` : ''}.`];
        for (const file of choice.settingsFiles) {
            const result = await this.service.importSettings(file);
            parts.push(`Settings: ${result.added} added${result.skipped ? `, ${result.skipped} kept as they were` : ''}.`);
        }
        for (const file of choice.keybindingFiles) {
            const result = await this.service.importKeybindings(file);
            parts.push(`Keybindings: ${result.added} added${result.skipped ? `, ${result.skipped} skipped` : ''}.`);
        }
        await this.storage.setData(IMPORT_PROMPTED_KEY, true);
        return parts.join(' ');
    }
}
