import type { SettingsAction } from '../../common/settings/settings.types';

export const SETTINGS_OPEN_COMMAND = { id: 'ingot.settings.open', label: 'Settings…', category: 'Ingot' } as const;
export const THEME_IMPORT_COMMAND = { id: 'ingot.theme.import', label: 'Import VS Code Color Theme…', category: 'Ingot' } as const;
export const PLUGINS_OPEN_COMMAND = 'vsxExtensions.toggle';

/** Settings page buttons → commands they run after the dialog closes. */
export const SETTINGS_ACTION_COMMANDS: Record<SettingsAction, string> = {
    openKeymap: 'keymaps:open',
    openModels: 'ingot.models.open',
    openAgentConfig: 'ingot.agentConfig.open',
    openPlugins: PLUGINS_OPEN_COMMAND,
    importTheme: THEME_IMPORT_COMMAND.id,
    openAllSettings: 'preferences:open',
    openSettingsJson: 'preferences:openJson.toUser'
};

/** Actions that keep the dialog open (they open a picker on top). */
export const INLINE_ACTIONS: ReadonlySet<SettingsAction> = new Set(['importTheme']);

export const settingDomId = (key: string): string => `ingot-setting-${key.replace(/[^a-zA-Z0-9]+/g, '-')}`;
