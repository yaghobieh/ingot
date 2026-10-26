import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandRegistry, type CommandContribution } from '@theia/core/lib/common/command';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import type { JsonSchemaContribution, JsonSchemaRegisterContext } from '@theia/core/lib/browser/json-schema-store';
import { open, OpenerService } from '@theia/core/lib/browser/opener-service';
import { MessageService } from '@theia/core/lib/common/message-service';
import { BinaryBuffer } from '@theia/core/lib/common/buffer';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { UserStorageUri } from '@theia/userstorage/lib/browser';
import { GLOBAL_SETTINGS_COMMAND, GLOBAL_SETTINGS_FILE, GLOBAL_SETTINGS_TEMPLATE } from '../../common/settings/global-settings.consts';
import { secretLikeKeys } from '../../common/settings/global-settings.utils';

/** Same schema as user settings.json (autocomplete and validation). */
const USER_SETTINGS_SCHEMA = 'vscode://schemas/settings/user';

/** IDEA-94: Open Global Settings (JSON), its schema, and a warning when it holds something that looks like a secret. */
@injectable()
export class IngotGlobalSettingsContribution implements CommandContribution, JsonSchemaContribution, FrontendApplicationContribution {

    @inject(FileService) protected readonly files: FileService;
    @inject(OpenerService) protected readonly openers: OpenerService;
    @inject(MessageService) protected readonly messages: MessageService;

    protected readonly uri = UserStorageUri.resolve(GLOBAL_SETTINGS_FILE);
    protected warned = '';

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(GLOBAL_SETTINGS_COMMAND, { execute: () => this.openFile() });
    }

    registerSchemas(context: JsonSchemaRegisterContext): void {
        context.registerSchema({ fileMatch: this.uri.toString(), url: USER_SETTINGS_SCHEMA });
    }

    onDidInitializeLayout(): void {
        this.checkSecrets();
        this.files.onDidFilesChange(event => {
            if (event.contains(this.uri)) {
                this.checkSecrets();
            }
        });
    }

    async openFile(): Promise<void> {
        if (!await this.files.exists(this.uri)) {
            await this.files.createFile(this.uri, BinaryBuffer.fromString(GLOBAL_SETTINGS_TEMPLATE));
        }
        await open(this.openers, this.uri);
    }

    protected async checkSecrets(): Promise<void> {
        try {
            const text = (await this.files.read(this.uri)).value;
            const keys = secretLikeKeys(JSON.parse(text.replace(/^\s*\/\/.*$/gm, '')));
            const signature = keys.join(',');
            if (keys.length && signature !== this.warned) {
                this.warned = signature;
                this.messages.warn(`${GLOBAL_SETTINGS_FILE} has ${keys.length === 1 ? 'a setting' : 'settings'} that look${keys.length === 1 ? 's' : ''} like a secret (${keys.join(', ')}). Keys belong in the Keychain: Settings › Models & API Keys.`);
            }
        } catch {
            // Missing or mid-edit file: nothing to check.
        }
    }
}
