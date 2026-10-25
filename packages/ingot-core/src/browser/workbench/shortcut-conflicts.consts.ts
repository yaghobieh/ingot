/**
 * Keys the Ingot keymap owns outright (IDEA-122). After startup every other binding on these keys is removed and
 * only the Ingot command is bound back, so it wins whatever has focus. ⇧⌘K was shadowed twice:
 * - Rerun Last Task (`task:run:last`) whenever focus was outside a text input (project tree, chat, tool windows);
 * - the editor's Delete Line (`editor.action.deleteLines`) inside the editor (Ingot uses ⌘⌫ for Delete Line).
 */
export const CLAIMED_KEYS: readonly { readonly keybinding: string; readonly command: string }[] = [
    { keybinding: 'ctrlcmd+shift+k', command: 'ingot.commit.push' }
];
