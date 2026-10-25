import { inject, injectable } from '@theia/core/shared/inversify';
import { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { DisposableCollection } from '@theia/core/lib/common/disposable';
import { isOSX } from '@theia/core/lib/common/os';
import { PreferenceSchema, PreferenceService } from '@theia/core/lib/common/preferences';
import { FrontendApplicationContribution, KeybindingRegistry, QuickInputService } from '@theia/core/lib/browser';
import { LabelProvider } from '@theia/core/lib/browser/label-provider';
import { MessageService } from '@theia/core/lib/common/message-service';
import { EditorManager } from '@theia/editor/lib/browser/editor-manager';
import { WorkspaceService } from '@theia/workspace/lib/browser/workspace-service';
import URI from '@theia/core/lib/common/uri';
import { DOUBLE_SHIFT_MS, INGOT_NAV_COMMANDS, INGOT_KEYMAP, KEYMAP_OPTIONS, KEYMAP_PREFERENCE } from '../../common/keymap/ingot.keymap.consts';
import { createDoubleShiftDetector, resolveKeymap } from '../../common/keymap/keymap.utils';
import { NavigationHistory } from './navigation-history';

export const keymapPreferenceSchema: PreferenceSchema = {
    properties: {
        [KEYMAP_PREFERENCE]: {
            type: 'string', enum: [...KEYMAP_OPTIONS], default: KEYMAP_OPTIONS[0],
            description: 'Keyboard shortcuts: Ingot (default) or Alternative (the platform defaults). Individual shortcuts can be changed in Keymap (Keyboard Shortcuts).'
        }
    }
};

/**
 * Ingot keymap (IDEA-18), Search Everywhere on double Shift (IDEA-19), Go to Class / Symbol (IDEA-20),
 * Recent Files / Recent Locations (IDEA-17).
 */
@injectable()
export class IngotKeymapContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(KeybindingRegistry) protected readonly keybindings: KeybindingRegistry;
    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(NavigationHistory) protected readonly history: NavigationHistory;
    @inject(EditorManager) protected readonly editors: EditorManager;
    @inject(LabelProvider) protected readonly labels: LabelProvider;
    @inject(WorkspaceService) protected readonly workspace: WorkspaceService;
    @inject(MessageService) protected readonly messages: MessageService;

    protected readonly bindings = new DisposableCollection();
    protected readonly detectDoubleShift = createDoubleShiftDetector(DOUBLE_SHIFT_MS);

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(INGOT_NAV_COMMANDS.searchEverywhere, { execute: () => this.quickInput.open('') });
        registry.registerCommand(INGOT_NAV_COMMANDS.goToClass, { execute: () => this.quickInput.open('#') });
        registry.registerCommand(INGOT_NAV_COMMANDS.goToSymbol, { execute: () => this.quickInput.open('#') });
        registry.registerCommand(INGOT_NAV_COMMANDS.recentFiles, { execute: () => this.showRecentFiles() });
        registry.registerCommand(INGOT_NAV_COMMANDS.recentLocations, { execute: () => this.showRecentLocations() });
    }

    async onStart(): Promise<void> {
        // Registered after every contribution's defaults, so these shortcuts take precedence.
        await this.preferences.ready;
        this.applyKeymap();
        this.preferences.onPreferenceChanged(event => {
            if (event.preferenceName === KEYMAP_PREFERENCE) {
                this.applyKeymap();
                this.messages.info(`Keymap: ${this.keymap}.`);
            }
        });
        document.addEventListener('keydown', event => {
            if (event.repeat) {
                return;
            }
            if (this.keymap !== KEYMAP_OPTIONS[1] && this.detectDoubleShift(event.key, event.ctrlKey || event.altKey || event.metaKey)) {
                this.quickInput.open('');
            }
        }, true);
    }

    protected get keymap(): string {
        return this.preferences.get<string>(KEYMAP_PREFERENCE, KEYMAP_OPTIONS[0]);
    }

    protected applyKeymap(): void {
        this.bindings.dispose();
        if (this.keymap !== KEYMAP_OPTIONS[1]) {
            this.bindings.push(this.keybindings.registerKeybindings(...resolveKeymap(INGOT_KEYMAP, isOSX)));
        }
    }

    protected relative(uri: URI): string {
        const root = this.workspace.tryGetRoots().find(r => r.resource.isEqualOrParent(uri));
        return root ? root.resource.relative(uri)?.toString() ?? uri.path.toString() : uri.path.toString();
    }

    protected async showRecentFiles(): Promise<void> {
        const current = this.editors.currentEditor?.editor.uri.toString();
        // Like classic IDEs, the first entry is the previous file so Cmd+E, Enter switches back.
        const files = this.history.files.filter(u => u.toString() !== current);
        const picked = await this.quickInput.showQuickPick(files.map(uri => ({
            label: this.labels.getName(uri), description: this.relative(uri), iconClasses: this.labels.getIcon(uri).split(' ').filter(Boolean), uri
        })), { title: 'Recent Files', placeholder: 'Type to filter recent files' });
        if (picked) {
            await this.editors.open(picked.uri, { mode: 'activate' });
        }
    }

    protected async showRecentLocations(): Promise<void> {
        const picked = await this.quickInput.showQuickPick(this.history.locations.map(place => {
            const uri = new URI(place.uri);
            return { label: `${this.labels.getName(uri)}:${place.line + 1}`, description: place.text, detail: this.relative(uri), place };
        }), { title: 'Recent Locations', placeholder: 'Type to filter recent locations', matchOnDescription: true });
        if (picked) {
            const { line, character } = picked.place;
            await this.editors.open(new URI(picked.place.uri), { mode: 'activate', selection: { start: { line, character }, end: { line, character } } });
        }
    }
}
