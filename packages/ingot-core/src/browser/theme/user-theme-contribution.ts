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
import type { StoreInstalledTheme } from '../../common/theme/theme-store.types';
import { Emitter } from '@theia/core/lib/common/event';
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
    protected readonly onDidChangeEmitter = new Emitter<void>();
    /** Fires when themes are installed, imported or removed (IDEA-144). */
    readonly onDidChange = this.onDidChangeEmitter.event;

    async onStart(): Promise<void> {
        for (const theme of await this.load()) {
            this.register(theme);
        }
        // Slot themes (IDEA-144) may be store themes: let Appearance re-check once they exist.
        this.onDidChangeEmitter.fire();
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(THEME_IMPORT_COMMAND, { execute: (uri?: unknown) => this.importTheme(typeof uri === 'string' ? new URI(uri) : undefined) });
        registry.registerCommand(THEME_REMOVE_COMMAND, { execute: () => this.removeTheme() });
    }

    async load(): Promise<StoreInstalledTheme[]> {
        const stored = await this.storage.getData<StoreInstalledTheme[]>(USER_THEMES_STORAGE_KEY, []);
        return Array.isArray(stored) ? stored : [];
    }

    protected register(theme: StoreInstalledTheme): void {
        this.registered.get(theme.id)?.dispose();
        // Store themes keep their own name; themes imported from a file are marked as such.
        const label = theme.source ? theme.label : `${theme.label} (imported)`;
        this.registered.set(theme.id, this.theming.registerParsedTheme({ id: theme.id, label, uiTheme: theme.uiTheme, json: theme.json }));
    }

    /** IDEA-144: adds (or updates) themes from an Open VSX package. */
    async install(themes: readonly StoreInstalledTheme[]): Promise<void> {
        let all = await this.load();
        for (const theme of themes) {
            all = upsertTheme(all, theme);
        }
        await this.storage.setData(USER_THEMES_STORAGE_KEY, all);
        themes.forEach(theme => this.register(theme));
        this.onDidChangeEmitter.fire();
    }

    /** IDEA-144: removes every theme of an extension (or one imported theme by id). Returns the removed ids. */
    async uninstall(match: { extensionId?: string; themeId?: string }): Promise<string[]> {
        const all = await this.load();
        const removed = all.filter(t => (match.extensionId && t.source?.extensionId === match.extensionId) || (match.themeId && t.id === match.themeId));
        if (!removed.length) {
            return [];
        }
        await this.storage.setData(USER_THEMES_STORAGE_KEY, all.filter(t => !removed.includes(t)));
        const ids = removed.map(t => t.id);
        if (ids.includes(this.themes.getCurrentTheme().id) || ids.includes(this.preferences.get<string>(SETTINGS_PREFS.colorTheme) ?? '')) {
            await this.preferences.set(SETTINGS_PREFS.colorTheme, undefined, PreferenceScope.User);
        }
        for (const id of ids) {
            this.registered.get(id)?.dispose();
            this.registered.delete(id);
        }
        this.onDidChangeEmitter.fire();
        return ids;
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
            this.onDidChangeEmitter.fire();
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
        await this.uninstall({ themeId: pick.id });
    }
}
