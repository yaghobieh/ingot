import { inject, injectable } from '@theia/core/shared/inversify';
import { type FrontendApplicationContribution, StatusBar, StatusBarAlignment } from '@theia/core/lib/browser';
import { QuickInputService } from '@theia/core/lib/browser/quick-input';
import { ThemeService } from '@theia/core/lib/browser/theming';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { type PreferenceSchema, PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { SETTINGS_PREFS } from '../../common/settings/settings.consts';
import { APPEARANCE_LABELS, APPEARANCE_MODES, APPEARANCE_PREFERENCE, DEFAULT_APPEARANCE, themeForAppearance, toAppearanceMode, type AppearanceMode } from '../../common/theme/appearance.utils';

export const APPEARANCE_PICK_COMMAND = { id: 'ingot.appearance.pick', label: 'Theme: Light, Dark or System', category: 'Ingot' } as const;
export const APPEARANCE_STATUS_ID = 'ingot-appearance';
const DARK_QUERY = '(prefers-color-scheme: dark)';
const ICONS: Record<AppearanceMode, string> = { system: 'color-mode', light: 'symbol-color', dark: 'circle-filled', custom: 'paintcan' };

export const appearancePreferenceSchema: PreferenceSchema = {
    properties: {
        [APPEARANCE_PREFERENCE]: {
            type: 'string', enum: [...APPEARANCE_MODES], default: DEFAULT_APPEARANCE,
            enumItemLabels: APPEARANCE_MODES.map(m => APPEARANCE_LABELS[m]),
            description: 'Light, Dark or System (follows the operating system and switches live). Picking another color theme switches to Custom theme.'
        } as PreferenceSchema['properties'][string]
    }
};

/** Light / Dark / System theme switching (IDEA-35): toolbar, status bar, Settings and Welcome all use this. */
@injectable()
export class AppearanceContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(ThemeService) protected readonly themes: ThemeService;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(StatusBar) protected readonly statusBar: StatusBar;

    protected media: MediaQueryList | undefined;
    protected applying = false;
    protected lastApplied: string | undefined;

    get mode(): AppearanceMode {
        return toAppearanceMode(this.preferences.get(APPEARANCE_PREFERENCE, DEFAULT_APPEARANCE));
    }

    async onStart(): Promise<void> {
        await this.preferences.ready;
        this.media = window.matchMedia?.(DARK_QUERY);
        this.media?.addEventListener('change', () => this.apply());
        this.preferences.onPreferenceChanged(event => {
            if (event.preferenceName === APPEARANCE_PREFERENCE) {
                this.apply();
            } else if (event.preferenceName === SETTINGS_PREFS.colorTheme && !this.applying) {
                this.onColorThemeChosen(this.preferences.inspect<string>(SETTINGS_PREFS.colorTheme)?.globalValue);
            }
        });
        this.apply();
    }

    registerCommands(registry: CommandRegistry): void {
        registry.registerCommand(APPEARANCE_PICK_COMMAND, { execute: () => this.pick() });
    }

    async setMode(mode: AppearanceMode): Promise<void> {
        await this.preferences.set(APPEARANCE_PREFERENCE, mode, PreferenceScope.User);
        this.apply();
    }

    protected async pick(): Promise<void> {
        const current = this.mode;
        const items = (['light', 'dark', 'system'] as const).map(mode => ({
            id: mode, label: APPEARANCE_LABELS[mode], description: mode === current ? 'current' : mode === 'system' ? 'follows your OS' : undefined
        }));
        const choice = await this.quickInput.showQuickPick(items, { placeholder: 'Theme' });
        if (choice) {
            await this.setMode(choice.id);
        }
    }

    /** A theme picked elsewhere (Settings, theme import, plugin) that isn't the Light/Dark/System one switches to Custom. */
    protected onColorThemeChosen(themeId: string | undefined): void {
        // A removed/reset value is not a choice; neither is the echo of a theme we applied ourselves.
        const expected = themeForAppearance(this.mode, !!this.media?.matches);
        if (expected && themeId && themeId !== expected && themeId !== this.lastApplied) {
            this.preferences.set(APPEARANCE_PREFERENCE, 'custom', PreferenceScope.User);
        }
    }

    protected async apply(): Promise<void> {
        const mode = this.mode;
        const target = themeForAppearance(mode, !!this.media?.matches);
        if (target && this.themes.getCurrentTheme().id !== target) {
            this.applying = true;
            this.lastApplied = target;
            try {
                this.themes.setCurrentTheme(target, false);
                if (this.preferences.get(SETTINGS_PREFS.colorTheme) !== target) {
                    await this.preferences.set(SETTINGS_PREFS.colorTheme, target, PreferenceScope.User);
                }
            } finally {
                this.applying = false;
            }
        }
        this.statusBar.setElement(APPEARANCE_STATUS_ID, {
            text: `$(${ICONS[mode]}) ${APPEARANCE_LABELS[mode]}`, tooltip: 'Theme: Light, Dark or System', alignment: StatusBarAlignment.RIGHT,
            priority: 5, command: APPEARANCE_PICK_COMMAND.id
        });
    }
}

