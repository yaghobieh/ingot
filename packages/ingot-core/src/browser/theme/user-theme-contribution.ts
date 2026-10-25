import { inject, injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { QuickInputService } from '@theia/core/lib/browser/quick-input';
import { StorageService } from '@theia/core/lib/browser/storage-service';
import { ThemeService } from '@theia/core/lib/browser/theming';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { Disposable } from '@theia/core/lib/common/disposable';
import { MessageService } from '@theia/core/lib/common/message-service';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import URI from '@theia/core/lib/common/uri';
import { FileDialogService } from '@theia/filesystem/lib/browser/file-dialog/file-dialog-service';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { MonacoThemingService } from '@theia/monaco/lib/browser/monaco-theming-service';
import { SETTINGS_PREFS } from '../../common/settings/settings.consts';
import { parseVsCodeTheme, upsertTheme, USER_THEMES_STORAGE_KEY, type ImportedTheme } from '../../common/theme/theme-import.utils';
import { THEME_IMPORT_COMMAND, THEME_REMOVE_COMMAND } from '../settings/settings.browser-consts';

/** User color themes imported from color theme files (IDEA-35), kept in browser storage and re-registered on start. */
@injectable()
export class UserThemeContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(MonacoThemingService) protected readonly theming: MonacoThemingService;
    @inject(StorageService) protected readonly storage: StorageService;
    @inject(ThemeService) protected readonly themes: ThemeService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(FileDialogService) protected readonly fileDialog: FileDialogService;
    @inject(FileService) protected readonly files: FileService;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;

    protected readonly registered = new Map<string, Disposable>();

    async onStart(): Promise<void> {
        for (const theme of await this.load()) {
            this.register(theme);
        }
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(THEME_IMPORT_COMMAND, { execute: (uri?: unknown) => this.importTheme(typeof uri === 'string' ? new URI(uri) : undefined) });
        registry.registerCommand(THEME_REMOVE_COMMAND, { execute: () => this.removeTheme() });
    }

    protected async load(): Promise<ImportedTheme[]> {
        const stored = await this.storage.getData<ImportedTheme[]>(USER_THEMES_STORAGE_KEY, []);
        return Array.isArray(stored) ? stored : [];
    }

    protected register(theme: ImportedTheme): void {
        this.registered.get(theme.id)?.dispose();
        this.registered.set(theme.id, this.theming.registerParsedTheme({ id: theme.id, label: `${theme.label} (imported)`, uiTheme: theme.uiTheme, json: theme.json }));
    }

    async importTheme(given?: URI): Promise<ImportedTheme | undefined> {
        const root = this.workspace.tryGetRoots()[0];
        const uri = given ?? await this.fileDialog.showOpenDialog({
            title: 'Import Color Theme', canSelectFiles: true, canSelectFolders: false, openLabel: 'Import',
            filters: { 'Color theme': ['json', 'jsonc'] }
        }, root);
        if (!uri) {
            return undefined;
        }
        try {
            const content = await this.files.read(uri);
            const theme = parseVsCodeTheme(content.value, uri.path.base);
            await this.storage.setData(USER_THEMES_STORAGE_KEY, upsertTheme(await this.load(), theme));
            this.register(theme);
            await this.preferences.set(SETTINGS_PREFS.colorTheme, theme.id, PreferenceScope.User);
            this.messages.info(`Imported color theme “${theme.label}”.`);
            return theme;
        } catch (error) {
            this.messages.error(`Could not import theme: ${error instanceof Error ? error.message : String(error)}`);
            return undefined;
        }
    }

    protected async removeTheme(): Promise<void> {
        const themes = await this.load();
        if (!themes.length) {
            this.messages.info('No imported color themes.');
            return;
        }
        const pick = await this.quickInput.showQuickPick(themes.map(t => ({ label: t.label, id: t.id })), { placeholder: 'Remove an imported color theme' });
        if (!pick) {
            return;
        }
        await this.storage.setData(USER_THEMES_STORAGE_KEY, themes.filter(t => t.id !== pick.id));
        if (this.themes.getCurrentTheme().id === pick.id) {
            await this.preferences.set(SETTINGS_PREFS.colorTheme, undefined, PreferenceScope.User);
        }
        this.registered.get(pick.id)?.dispose();
        this.registered.delete(pick.id);
    }
}
