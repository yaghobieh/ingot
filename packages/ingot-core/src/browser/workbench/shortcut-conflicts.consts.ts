/**
 * Built-in commands whose default keys collide with the Ingot keymap (IDEA-122). Their bindings are removed after
 * startup so the Ingot action always wins, whatever has focus:
 * - `task:run:last` (Rerun Last Task) took ⇧⌘K whenever focus was outside a text input, so Push never opened from
 *   the project tree, chat or a tool window.
 */
export const CONFLICTING_COMMANDS: readonly string[] = ['task:run:last'];
