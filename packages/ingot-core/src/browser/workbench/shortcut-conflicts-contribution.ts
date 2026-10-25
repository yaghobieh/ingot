import { inject, injectable, optional } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import type { FrontendApplication } from '@theia/core/lib/browser/frontend-application';
import { KeybindingRegistry } from '@theia/core/lib/browser/keybinding';
import { CLAIMED_KEYS } from './shortcut-conflicts.consts';

/** Rebuilds the native application menu so its accelerators follow the keybinding changes (desktop app only). */
export const NativeMenuRefresher = Symbol('NativeMenuRefresher');
export interface NativeMenuRefresher {
    refresh(app: FrontendApplication): void;
}

/** Gives claimed keys to their Ingot command only (e.g. ⇧⌘K is always Push, never Rerun Last Task or Delete Line). */
@injectable()
export class IngotShortcutConflictsContribution implements FrontendApplicationContribution {

    @inject(KeybindingRegistry) protected readonly keybindings: KeybindingRegistry;
    @inject(NativeMenuRefresher) @optional() protected readonly nativeMenu?: NativeMenuRefresher;

    onDidInitializeLayout(app: FrontendApplication): void {
        for (const { keybinding, command } of CLAIMED_KEYS) {
            this.keybindings.unregisterKeybinding(keybinding);
            this.keybindings.registerKeybinding({ command, keybinding });
        }
        // The native menu (e.g. Selection › Delete Line) captured ⇧⌘K as an accelerator at startup; rebuild it.
        this.nativeMenu?.refresh(app);
    }
}
