import type { Command } from '@theia/core/lib/common/command';

/** IDEA-94: user-level settings shared by every project, in the Ingot config folder (~/.ingot). */
export const GLOBAL_SETTINGS_FILE = 'ingot.settings.json';
export const GLOBAL_SETTINGS_COMMAND: Command = { id: 'ingot.settings.openGlobalJson', label: 'Open Global Settings (JSON)', category: 'Preferences' };

/** Written when the file does not exist yet. Theme defaults to System. */
export const GLOBAL_SETTINGS_TEMPLATE = `{
    // Ingot global settings (~/.ingot/${GLOBAL_SETTINGS_FILE}): theme, fonts, editor, keymap, layout…
    // A project's .ingot/settings.json wins over this file. Never put API keys or tokens here: they live in the Keychain.
    "ingot.appearance": "system",
    "editor.wordWrap": "on"
}
`;

/** Setting names that look like credentials; values under them are never expected in this file. */
export const SECRET_KEY_PATTERN = /(api[-_.]?key|secret|token|password|passwd|credential)/i;
