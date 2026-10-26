export type SettingsAction = 'openKeymap' | 'openModels' | 'openAgentConfig' | 'openPlugins' | 'importTheme' | 'removeTheme' | 'openAllSettings' | 'openSettingsJson';

export interface SettingsPage {
    readonly id: string;
    readonly label: string;
    readonly children?: readonly SettingsPage[];
    /** Preference keys edited on this page, rendered from their schema. */
    readonly preferences?: readonly string[];
    readonly actions?: readonly { readonly id: SettingsAction; readonly label: string }[];
    readonly description?: string;
    /** Codicon shown next to top-level categories. */
    readonly icon?: string;
    /** Optional card grouping of `preferences`; ungrouped keys go to a 'General' card. */
    readonly groups?: readonly SettingsGroup[];
    /** A page with its own UI instead of preferences (e.g. the Memories manager). */
    readonly custom?: 'memories' | 'approvals';
}

export interface SettingsGroup {
    readonly label: string;
    readonly preferences: readonly string[];
}

export interface SettingInfo {
    readonly key: string;
    readonly description?: string;
    readonly enumValues?: readonly string[];
}
