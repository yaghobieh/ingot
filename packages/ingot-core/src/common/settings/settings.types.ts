export type SettingsAction = 'openKeymap' | 'openModels' | 'openAgentConfig' | 'openPlugins' | 'importTheme' | 'removeTheme' | 'openAllSettings' | 'openSettingsJson';

export interface SettingsPage {
    readonly id: string;
    readonly label: string;
    readonly children?: readonly SettingsPage[];
    /** Preference keys edited on this page, rendered from their schema. */
    readonly preferences?: readonly string[];
    readonly actions?: readonly { readonly id: SettingsAction; readonly label: string }[];
    readonly description?: string;
}

export interface SettingInfo {
    readonly key: string;
    readonly description?: string;
    readonly enumValues?: readonly string[];
}
