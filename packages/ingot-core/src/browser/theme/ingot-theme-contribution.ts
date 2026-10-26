import { inject, injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MonacoThemingService } from '@theia/monaco/lib/browser/monaco-theming-service';
import { ThemeService } from '@theia/core/lib/browser/theming';
import type { Theme } from '@theia/core/lib/common/theme';
import { INGOT_THEMES } from '../../common/theme/theme.consts';
import { buildThemeJson } from '../../common/theme/theme.utils';

/** Registers the Ingot Light / Dark / Ember themes (IDEA-16, IDEA-35). */
@injectable()
export class IngotThemeContribution implements FrontendApplicationContribution {

    @inject(MonacoThemingService)
    protected readonly theming: MonacoThemingService;

    @inject(ThemeService)
    protected readonly themes: ThemeService;

    initialize(): void {
        // tokens.css switches the --ingot-* tokens on [data-theme='dark']; keep it in sync so Ingot chrome
        // (title bar icons, pills, debugger controls) gets the dark palette too.
        this.applyTokens(this.themes.getCurrentTheme());
        this.themes.onDidColorThemeChange(e => this.applyTokens(e.newTheme));
        for (const theme of INGOT_THEMES) {
            this.theming.registerParsedTheme({ id: theme.id, label: theme.label, uiTheme: theme.uiTheme, json: buildThemeJson(theme) });
        }
    }

    protected applyTokens(theme: Theme): void {
        document.documentElement.setAttribute('data-theme', theme.type === 'light' || theme.type === 'hcLight' ? 'light' : 'dark');
    }
}
