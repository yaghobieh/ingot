import { inject, injectable } from '@theia/core/shared/inversify';
import type { FrontendApplicationContribution } from '@theia/core/lib/browser';
import { MonacoThemingService } from '@theia/monaco/lib/browser/monaco-theming-service';
import { INGOT_THEMES } from '../../common/theme/theme.consts';
import { buildThemeJson } from '../../common/theme/theme.utils';

/** Registers the Ingot Light / Dark / Ember themes (IDEA-16, IDEA-35). */
@injectable()
export class IngotThemeContribution implements FrontendApplicationContribution {

    @inject(MonacoThemingService)
    protected readonly theming: MonacoThemingService;

    initialize(): void {
        for (const theme of INGOT_THEMES) {
            this.theming.registerParsedTheme({ id: theme.id, label: theme.label, uiTheme: theme.uiTheme, json: buildThemeJson(theme) });
        }
    }
}
