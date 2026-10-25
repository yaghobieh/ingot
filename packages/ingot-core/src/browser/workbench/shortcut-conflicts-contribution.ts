import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { CONFLICTING_COMMANDS } from './shortcut-conflicts.consts';

/** Drops built-in bindings that shadow Ingot shortcuts (e.g. ⇧⌘K Push vs Rerun Last Task). */
@injectable()
export class IngotShortcutConflictsContribution implements FrontendApplicationContribution {

    @inject(KeybindingRegistry) protected readonly keybindings: KeybindingRegistry;

    onDidInitializeLayout(): void {
        for (const id of CONFLICTING_COMMANDS) {
            this.keybindings.unregisterKeybinding({ id });
        }
    }
}
