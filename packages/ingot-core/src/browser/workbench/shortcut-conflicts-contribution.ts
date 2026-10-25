import { inject, injectable } from '@theia/core/shared/inversify';
import { FrontendApplicationContribution } from '@theia/core/lib/browser/frontend-application-contribution';
import { KeybindingRegistry, KeybindingScope } from '@theia/core/lib/browser/keybinding';
import { CLAIMED_KEYS } from './shortcut-conflicts.consts';

/** Gives claimed keys to their Ingot command only (e.g. ⇧⌘K is always Push, never Rerun Last Task or Delete Line). */
@injectable()
export class IngotShortcutConflictsContribution implements FrontendApplicationContribution {

    @inject(KeybindingRegistry) protected readonly keybindings: KeybindingRegistry;

    onDidInitializeLayout(): void {
        for (const { keybinding, command } of CLAIMED_KEYS) {
            // Other contributions spell the same key differently (the editor registers `cmd+shift+k`), so compare
            // the resolved key sequence and drop every other binding on it, then bind the key back to the Ingot command.
            const target = this.sequence({ command, keybinding });
            const spellings = new Set(this.keybindings.getKeybindingsByScope(KeybindingScope.DEFAULT)
                .filter(b => b.command !== command && this.sequence(b) === target)
                .map(b => b.keybinding));
            spellings.add(keybinding);
            spellings.forEach(key => this.keybindings.unregisterKeybinding(key));
            this.keybindings.registerKeybinding({ command, keybinding });
        }
    }

    protected sequence(binding: { command: string; keybinding: string }): string {
        try {
            return this.keybindings.resolveKeybinding(binding).map(k => k.toString()).join(' ');
        } catch {
            return binding.keybinding;
        }
    }
}
