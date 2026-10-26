import type { SettingsAction } from '../../common/settings/settings.types';

export const SETTINGS_OPEN_COMMAND = { id: 'ingot.settings.open', label: 'Settings…', category: 'Ingot' } as const;
/** The full settings list behind the dialog's "All settings" link; the only way the generic list opens. */
export const ADVANCED_SETTINGS_COMMAND = { id: 'ingot.settings.advanced', label: 'All Settings (Advanced)', category: 'Ingot' } as const;
export const LEGACY_SETTINGS_WIDGET_ID = 'settings_widget';
export const THEME_IMPORT_COMMAND = { id: 'ingot.theme.import', label: 'Import Color Theme…', category: 'Ingot' } as const;
export const THEME_REMOVE_COMMAND = { id: 'ingot.theme.remove', label: 'Remove Imported Color Theme…', category: 'Ingot' } as const;
export const PLUGINS_OPEN_COMMAND = 'vsxExtensions.toggle';

/** Settings page buttons → commands they run after the dialog closes. */
export const SETTINGS_ACTION_COMMANDS: Record<SettingsAction, string> = {
    pickTheme: 'ingot.theme.pick',
    openKeymap: 'keymaps:open',
    openModels: 'ingot.models.open',
    openAgentConfig: 'ingot.agentConfig.open',
    openPlugins: PLUGINS_OPEN_COMMAND,
    importTheme: THEME_IMPORT_COMMAND.id,
    removeTheme: 'ingot.theme.remove',
    openAllSettings: 'ingot.settings.advanced',
    openSettingsJson: 'preferences:openJson.toUser'
};

/** Actions that keep the dialog open (they open a picker on top). */
export const INLINE_ACTIONS: ReadonlySet<SettingsAction> = new Set(['pickTheme', 'importTheme', 'removeTheme']);

export const settingDomId = (key: string): string => `ingot-setting-${key.replace(/[^a-zA-Z0-9]+/g, '-')}`;

export const SettingsDialogProvider = Symbol('SettingsDialogProvider');
export const SettingsDialogProps = Symbol('SettingsDialogProps');
