import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { MessageService } from '@theia/core/lib/common/message-service';
import { isOSX, isWindows } from '@theia/core/lib/common/os';
import { PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { FrontendApplicationContribution, Saveable } from '@theia/core/lib/browser';
import { ClipboardService } from '@theia/core/lib/browser/clipboard-service';
import { WindowService } from '@theia/core/lib/browser/window/window-service';
import type URI from '@theia/core/lib/common/uri';
import { EditorManager } from '@theia/editor/lib/browser';
import { FileService } from '@theia/filesystem/lib/browser/file-service';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import { guidePlatform } from '../../common/debug/debug.utils';
import type { GuidePlatform } from '../../common/debug/debug.types';
import { LANGUAGE_COMMANDS, LANGUAGE_PREFS, LANGUAGE_TEXT, LANGUAGES_SETTINGS_PAGE, TOOLCHAINS } from '../../common/languages/languages.consts';
import type { LanguageId, ToolchainId } from '../../common/languages/languages.types';
import {
    buildRecipeFor, installCommand, isUsable, javaLauncher, languageById, languageForFile, missingToolchainMessage, runCommandFor, toolchainsToPrompt
} from '../../common/languages/languages.utils';
import { SETTINGS_OPEN_COMMAND } from '../settings/settings.browser-consts';
import { LanguageSupportStore } from './language-support-store';
import { LanguageRunner } from './language-runner';

const PACKAGE_JSON = 'package.json';

/** IDEA-313: the Languages page command, install prompts for missing toolchains, Run Current File and Build Project. */
@injectable()
export class LanguagesContribution implements CommandContribution, FrontendApplicationContribution {

    @inject(LanguageSupportStore) protected readonly store: LanguageSupportStore;
    @inject(LanguageRunner) protected readonly runner: LanguageRunner;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(FileService) protected readonly files: FileService;
    @inject(MessageService) protected readonly messages: MessageService;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(ClipboardService) protected readonly clipboard: ClipboardService;
    @inject(WindowService) protected readonly windows: WindowService;
    @inject(CommandRegistry) protected readonly commands: CommandRegistry;

    /** Languages already prompted for in this session. */
    protected readonly prompted = new Set<LanguageId>();

    get platform(): GuidePlatform {
        return guidePlatform(isOSX ? 'mac' : isWindows ? 'windows' : 'linux');
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(LANGUAGE_COMMANDS.open, {
            execute: () => registry.executeCommand(SETTINGS_OPEN_COMMAND.id, LANGUAGES_SETTINGS_PAGE)
        });
        registry.registerCommand(LANGUAGE_COMMANDS.refresh, {
            execute: async () => {
                await this.store.refresh();
                this.prompted.clear();
                this.messages.info(LANGUAGE_TEXT.refreshed);
            }
        });
        registry.registerCommand(LANGUAGE_COMMANDS.runFile, { execute: () => this.runCurrentFile() });
        registry.registerCommand(LANGUAGE_COMMANDS.build, { execute: () => this.buildProject() });
    }

    onStart(): void {
        // Early, so the bundled Java is the COBOL / Kotlin servers' default before they start.
        void this.store.load().catch(() => undefined);
        this.editors.onCurrentEditorChanged(widget => widget && void this.promptFor(widget.editor.uri));
        const current = this.editors.currentEditor;
        if (current) {
            void this.promptFor(current.editor.uri);
        }
    }

    /** Once per language and session: a missing compiler or runtime gets an "install X" notification. */
    protected async promptFor(uri: URI): Promise<void> {
        const spec = languageForFile(uri.path.toString());
        if (!spec || this.prompted.has(spec.id) || !this.preferences.get<boolean>(LANGUAGE_PREFS.toolchainPrompts, true)) {
            return;
        }
        this.prompted.add(spec.id);
        await this.store.load();
        const [missing] = toolchainsToPrompt(spec, this.store.toolchains, this.dismissed());
        if (missing) {
            await this.showInstallPrompt(spec.label, missing, true);
        }
    }

    protected dismissed(): string[] {
        return this.preferences.get<string[]>(LANGUAGE_PREFS.dismissed, []);
    }

    protected async showInstallPrompt(language: string, id: ToolchainId, offerDismiss: boolean): Promise<void> {
        const message = missingToolchainMessage(language, id, this.store.toolchain(id), this.platform);
        const actions: string[] = [LANGUAGE_TEXT.copy, LANGUAGE_TEXT.download, LANGUAGE_TEXT.languages, ...(offerDismiss ? [LANGUAGE_TEXT.dontAsk] : [])];
        const action = await this.messages.warn(message, ...actions);
        if (action === LANGUAGE_TEXT.copy) {
            this.clipboard.writeText(installCommand(id, this.platform));
            this.messages.info(LANGUAGE_TEXT.copied);
        } else if (action === LANGUAGE_TEXT.download) {
            this.windows.openNewWindow(TOOLCHAINS[id].url, { external: true });
        } else if (action === LANGUAGE_TEXT.languages) {
            await this.commands.executeCommand(LANGUAGE_COMMANDS.open.id);
        } else if (action === LANGUAGE_TEXT.dontAsk) {
            await this.preferences.set(LANGUAGE_PREFS.dismissed, [...new Set([...this.dismissed(), id])], PreferenceScope.User);
        }
    }

    /** The first missing toolchain gets the install prompt (and the run is skipped). */
    protected async ensureToolchains(language: string, toolchains: readonly ToolchainId[]): Promise<boolean> {
        await this.store.load();
        const missing = toolchains.find(id => !isUsable(this.store.toolchain(id)));
        if (missing) {
            await this.showInstallPrompt(language, missing, false);
            return false;
        }
        return true;
    }

    protected async runCurrentFile(): Promise<void> {
        const widget = this.editors.currentEditor;
        if (!widget) {
            this.messages.info(LANGUAGE_TEXT.noFile);
            return;
        }
        const uri = widget.editor.uri;
        const [context] = await Promise.all([this.store.service.runContext(), this.store.load()]);
        const jdk = this.store.toolchain('jdk');
        const java = jdk?.bundled ? javaLauncher(jdk.path, isWindows) : undefined;
        const run = runCommandFor(uri.path.fsPath(), context.tmpdir, java);
        if (!run) {
            this.messages.info(LANGUAGE_TEXT.noRun);
            return;
        }
        if (!(await this.ensureToolchains(run.language.label, run.toolchains))) {
            return;
        }
        const saveable = Saveable.get(widget);
        if (saveable?.dirty) {
            await saveable.save();
        }
        await this.runner.run({ cwd: uri.parent.path.fsPath(), command: run.command, env: { PATH: context.path } });
    }

    protected async buildProject(): Promise<void> {
        const root = this.workspace.tryGetRoots()[0]?.resource;
        if (!root) {
            this.messages.info(LANGUAGE_TEXT.noBuild);
            return;
        }
        const stat = await this.files.resolve(root);
        const names = (stat.children ?? []).map(c => c.name);
        const packageJson = names.includes(PACKAGE_JSON)
            ? await this.files.read(root.resolve(PACKAGE_JSON)).then(c => c.value).catch(() => undefined)
            : undefined;
        const recipe = buildRecipeFor(names, packageJson);
        if (!recipe) {
            this.messages.info(LANGUAGE_TEXT.noBuild);
            return;
        }
        const label = languageById(recipe.language)?.label ?? recipe.language;
        if (!(await this.ensureToolchains(label, recipe.toolchains))) {
            return;
        }
        await this.saveAll();
        const context = await this.store.service.runContext();
        await this.runner.run({ cwd: root.path.fsPath(), command: recipe.command, env: { PATH: context.path } });
    }

    protected async saveAll(): Promise<void> {
        await Promise.all(this.editors.all.map(w => Saveable.get(w)).filter(s => s?.dirty).map(s => s?.save()));
    }
}
