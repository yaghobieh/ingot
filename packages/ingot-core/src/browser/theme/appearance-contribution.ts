import { inject, injectable } from '@theia/core/shared/inversify';
import { type FrontendApplicationContribution, StatusBar, StatusBarAlignment } from '@theia/core/lib/browser';
import { QuickInputService } from '@theia/core/lib/browser/quick-input';
import { ThemeService } from '@theia/core/lib/browser/theming';
import type { CommandContribution, CommandRegistry } from '@theia/core/lib/common/command';
import { type PreferenceSchema, PreferenceScope, PreferenceService } from '@theia/core/lib/common/preferences';
import { SETTINGS_PREFS } from '../../common/settings/settings.consts';
import {
    APPEARANCE_LABELS, APPEARANCE_MODES, APPEARANCE_PREFERENCE, DEFAULT_APPEARANCE, slotForAppearance, themeForAppearance, toAppearanceMode, type AppearanceMode, type ThemeSlots
} from '../../common/theme/appearance.utils';
import { THEME_IDS } from '../../common/theme/theme.consts';
import { THEME_SLOT_PREFERENCES } from '../../common/theme/theme-store.consts';
import type { ThemeSlot } from '../../common/theme/theme-store.types';
import { UserThemeContribution } from './user-theme-contribution';

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
        } as PreferenceSchema['properties'][string],
        [THEME_SLOT_PREFERENCES.light]: {
            type: 'string', default: THEME_IDS.light,
            description: 'Color theme used in Light mode and when System follows a light OS. Change it with Choose Theme….'
        },
        [THEME_SLOT_PREFERENCES.dark]: {
            type: 'string', default: THEME_IDS.dark,
            description: 'Color theme used in Dark mode and when System follows a dark OS. Change it with Choose Theme….'
        }
    }
};

/** Light / Dark / System theme switching (IDEA-35): toolbar, status bar, Settings and Welcome all use this. */
@injectable()
export class AppearanceContribution implements FrontendApplicationContribution, CommandContribution {

    @inject(PreferenceService) protected readonly preferences: PreferenceService;
    @inject(ThemeService) protected readonly themes: ThemeService;
    @inject(QuickInputService) protected readonly quickInput: QuickInputService;
    @inject(StatusBar) protected readonly statusBar: StatusBar;
    @inject(UserThemeContribution) protected readonly userThemes: UserThemeContribution;

    protected media: MediaQueryList | undefined;
    protected applying = false;
    protected lastApplied: string | undefined;

    get mode(): AppearanceMode {
        return toAppearanceMode(this.preferences.get(APPEARANCE_PREFERENCE, DEFAULT_APPEARANCE));
    }

    get osPrefersDark(): boolean {
        return !!this.media?.matches;
    }

    /** Slot themes that exist right now; a removed store theme falls back to Ingot Light / Dark. */
    get slots(): ThemeSlots {
        const known = new Set(this.themes.getThemes().map(t => t.id));
        const valid = (id: string | undefined) => id && known.has(id) ? id : undefined;
        return {
            light: valid(this.preferences.get<string>(THEME_SLOT_PREFERENCES.light)),
            dark: valid(this.preferences.get<string>(THEME_SLOT_PREFERENCES.dark))
        };
    }

    /** The slot a theme picker edits now (undefined in Custom theme mode). */
    get activeSlot(): ThemeSlot | undefined {
        return slotForAppearance(this.mode, this.osPrefersDark);
    }

    slotTheme(slot: ThemeSlot): string {
        return this.slots[slot] ?? (slot === 'light' ? THEME_IDS.light : THEME_IDS.dark);
    }

    async setSlotTheme(slot: ThemeSlot, themeId: string): Promise<void> {
        await this.preferences.set(THEME_SLOT_PREFERENCES[slot], themeId, PreferenceScope.User);
        await this.apply();
    }

    async onStart(): Promise<void> {
        await this.preferences.ready;
        this.media = window.matchMedia?.(DARK_QUERY);
        this.media?.addEventListener('change', () => this.apply());
        this.preferences.onPreferenceChanged(event => {
            if (event.preferenceName === APPEARANCE_PREFERENCE || event.preferenceName === THEME_SLOT_PREFERENCES.light || event.preferenceName === THEME_SLOT_PREFERENCES.dark) {
                this.apply();
            } else if (event.preferenceName === SETTINGS_PREFS.colorTheme && !this.applying) {
                this.onColorThemeChosen(this.preferences.inspect<string>(SETTINGS_PREFS.colorTheme)?.globalValue);
            }
        });
        this.userThemes.onDidChange(() => this.apply());
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
        const expected = themeForAppearance(this.mode, this.osPrefersDark, this.slots);
        if (expected && themeId && themeId !== expected && themeId !== this.lastApplied) {
            this.preferences.set(APPEARANCE_PREFERENCE, 'custom', PreferenceScope.User);
        }
    }

    protected async apply(): Promise<void> {
        const mode = this.mode;
        const target = themeForAppearance(mode, this.osPrefersDark, this.slots);
        if (target) {
            this.applying = true;
            this.lastApplied = target;
            try {
                if (this.themes.getCurrentTheme().id !== target) {
                    this.themes.setCurrentTheme(target, false);
                }
                // IDEA-281: the user settings file always names the theme on screen, even when it was already showing
                // (boot cache, OS switch). A stale value there made Theia restore the old theme on the next start and
                // its change event flipped Light / Dark / System to Custom.
                if (this.preferences.inspect<string>(SETTINGS_PREFS.colorTheme)?.globalValue !== target) {
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

