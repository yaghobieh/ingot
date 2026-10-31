import { inject, injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MonacoThemingService } from '@theia/monaco/lib/browser/monaco-theming-service';
import { ThemeService } from '@theia/core/lib/browser/theming';
import type { Theme } from '@theia/core/lib/common/theme';
import { INGOT_THEMES } from '../../common/theme/theme.consts';
import { buildThemeJson } from '../../common/theme/theme.utils';
import { APPEARANCE_BOOT_KEY, BOOT_THEME_ATTRIBUTE, THEME_KIND_ATTRIBUTE } from '../../common/theme/appearance-boot.consts';
import type { ThemeKind } from '../../common/theme/appearance-boot.types';
import { parseBoot, serializeBoot, themeKind } from '../../common/theme/appearance-boot.utils';

/** Registers the Ingot Light / Dark / Ember themes (IDEA-16, IDEA-35). */
@injectable()
export class IngotThemeContribution implements FrontendApplicationContribution {

    @inject(MonacoThemingService)
    protected readonly theming: MonacoThemingService;

    @inject(ThemeService)
    protected readonly themes: ThemeService;

    initialize(): void {
        for (const theme of INGOT_THEMES) {
            this.theming.registerParsedTheme({ id: theme.id, label: theme.label, uiTheme: theme.uiTheme, json: buildThemeJson(theme) });
        }
        // IDEA-281: Theia starts on its OS default theme and only reads the user setting once preferences load; put the
        // last applied theme back first so the shell never paints in the wrong one. AppearanceContribution then
        // reconciles with the settings file.
        const boot = parseBoot(this.readBoot());
        if (boot && this.themes.getThemes().some(theme => theme.id === boot.themeId)) {
            this.themes.setCurrentTheme(boot.themeId, false);
            this.applyTokens(this.themes.getCurrentTheme());
        } else if (boot) {
            // An imported theme registers later; keep its palette meanwhile and leave the cache as it is.
            this.setKind(boot.kind);
        } else {
            this.applyTokens(this.themes.getCurrentTheme());
        }
        this.themes.onDidColorThemeChange(e => this.applyTokens(e.newTheme));
    }

    protected applyTokens(theme: Theme): void {
        const kind = themeKind(theme.type);
        this.setKind(kind);
        this.writeBoot(theme.id, kind);
    }

    /**
     * tokens.css switches the --ingot-* tokens on [data-theme='dark']; keep it in sync so Ingot chrome
     * (title bar icons, pills, debugger controls) gets the dark palette too. The preload screen reads data-ingot-boot.
     */
    protected setKind(kind: ThemeKind): void {
        document.documentElement.setAttribute(THEME_KIND_ATTRIBUTE, kind);
        document.documentElement.setAttribute(BOOT_THEME_ATTRIBUTE, kind);
    }

    protected readBoot(): string | null {
        try {
            return window.localStorage.getItem(APPEARANCE_BOOT_KEY);
        } catch {
            return null;
        }
    }

    protected writeBoot(themeId: string, kind: ThemeKind): void {
        try {
            window.localStorage.setItem(APPEARANCE_BOOT_KEY, serializeBoot({ themeId, kind }));
        } catch {
            // Storage full or disabled: the next start just waits for preferences.
        }
    }
}
